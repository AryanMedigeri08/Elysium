import os
import sys
import re
import traceback
import threading
import pandas as pd
import numpy as np
import networkx as nx
import community as community_louvain
import google.auth
from google.cloud import bigquery
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Add parent directory to path to import model_router/retrieve
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ──────────────────────────────────────────────
# CONFIG / GCP PROJECT RESOLUTION
# ──────────────────────────────────────────────
try:
    _, default_project = google.auth.default()
except Exception:
    default_project = None
PROJECT_ID = default_project or "elysium-501518"

# ──────────────────────────────────────────────
# BIGQUERY CLIENT SETUP
# ──────────────────────────────────────────────
bq_client = None
try:
    bq_client = bigquery.Client(project=PROJECT_ID)
except Exception as e:
    print(f"[WARNING] Could not initialize BigQuery client: {e}. Falling back to simulated mode.")

# Initialize FastAPI
app = FastAPI(
    title="Elysium AI API",
    description="GPU-Accelerated Financial Risk Analytics & RAG-Powered Compliance Copilot",
    version="1.0.0"
)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# STARTUP: PRE-WARM ALL BIGQUERY CACHES
# ──────────────────────────────────────────────
@app.on_event("startup")
def prewarm_caches():
    """Pre-warm all BigQuery caches in a background thread so the first
    page load is instant and does not saturate the server threadpool."""
    if not bq_client:
        print("[INFO] No BigQuery client — skipping cache pre-warm.")
        return

    def _warm():
        global _metrics_cache, _risk_by_channel_cache, _temporal_risk_cache
        global _geographical_risk_cache, _risk_distribution_cache
        global _critical_events_cache, _graph_raw_cache

        queries = {
            "_metrics_cache": f"""
                SELECT COUNT(*) as total_transactions,
                       SUM(CASE WHEN fraud_flag = 1 THEN 1 ELSE 0 END) as fraud_count,
                       AVG(risk_score) as avg_risk_score,
                       SUM(CASE WHEN risk_score >= 0.6 THEN 1 ELSE 0 END) as high_risk_count
                FROM `{PROJECT_ID}.elysium.transactions_enriched`
            """,
            "_risk_by_channel_cache": f"""
                SELECT transaction_type, COUNT(*) as transaction_count,
                       ROUND(AVG(risk_score), 4) as avg_risk_score
                FROM `{PROJECT_ID}.elysium.transactions_enriched`
                GROUP BY transaction_type ORDER BY transaction_count DESC
            """,
            "_temporal_risk_cache": f"""
                SELECT FORMAT_TIMESTAMP('%Y-%m', timestamp) as month,
                       COUNT(*) as transaction_count, ROUND(AVG(risk_score), 4) as avg_risk_score
                FROM `{PROJECT_ID}.elysium.transactions_enriched`
                GROUP BY month ORDER BY month ASC
            """,
            "_geographical_risk_cache": f"""
                SELECT country, COUNT(*) as transaction_count,
                       ROUND(AVG(risk_score), 4) as avg_risk_score,
                       SUM(CASE WHEN risk_score >= 0.6 THEN 1 ELSE 0 END) as high_risk_count
                FROM `{PROJECT_ID}.elysium.transactions_enriched`
                GROUP BY country ORDER BY avg_risk_score DESC
            """,
            "_risk_distribution_cache": f"""
                SELECT CASE
                    WHEN risk_score = 0 THEN '0.00 (No Risk)'
                    WHEN risk_score > 0 AND risk_score <= 0.25 THEN '0.01\u20130.25 (Low)'
                    WHEN risk_score > 0.25 AND risk_score <= 0.50 THEN '0.26\u20130.50 (Medium)'
                    WHEN risk_score > 0.50 AND risk_score <= 0.75 THEN '0.51\u20130.75 (High)'
                    ELSE '0.76\u20131.00 (Critical)'
                END AS risk_bucket, COUNT(*) AS transaction_count
                FROM `{PROJECT_ID}.elysium.transactions_enriched`
                GROUP BY risk_bucket ORDER BY risk_bucket
            """,
            "_critical_events_cache": f"""
                SELECT transaction_id, timestamp, account_id, customer_id,
                       amount, transaction_type, merchant_category, country,
                       fraud_flag, volatility_index, risk_score
                FROM `{PROJECT_ID}.elysium.transactions_enriched`
                ORDER BY risk_score DESC, amount DESC LIMIT 10
            """,
            "_graph_raw_cache": f"""
                SELECT transaction_id, timestamp, account_id, customer_id,
                       amount, transaction_type, country, risk_score
                FROM `{PROJECT_ID}.elysium.transactions_enriched`
                WHERE risk_score >= 0.2 ORDER BY risk_score DESC LIMIT 300
            """,
        }

        for cache_name, query in queries.items():
            try:
                df = bq_client.query(query).to_dataframe()
                if cache_name == "_metrics_cache":
                    _metrics_cache = {
                        "total_transactions": int(df['total_transactions'].iloc[0]),
                        "fraud_count": int(df['fraud_count'].iloc[0] or 0),
                        "avg_risk_score": float(df['avg_risk_score'].iloc[0] or 0),
                        "high_risk_count": int(df['high_risk_count'].iloc[0] or 0)
                    }
                elif cache_name == "_critical_events_cache":
                    df['timestamp'] = df['timestamp'].dt.strftime('%Y-%m-%d %H:%M:%S')
                    _critical_events_cache = df.to_dict(orient="records")
                elif cache_name == "_graph_raw_cache":
                    _graph_raw_cache = df
                else:
                    globals()[cache_name] = df.to_dict(orient="records")
                print(f"[STARTUP] Pre-warmed {cache_name} OK")
            except Exception as e:
                print(f"[STARTUP] Failed to pre-warm {cache_name}: {e}")

    thread = threading.Thread(target=_warm, daemon=True)
    thread.start()
    print("[INFO] Cache pre-warm started in background thread.")


# ──────────────────────────────────────────────
# MOCK DATA GENERATORS (FALLBACK)
# ──────────────────────────────────────────────
def generate_mock_summary():
    return {
        "total_transactions": 500000,
        "fraud_count": 7500,
        "avg_risk_score": 0.1842,
        "high_risk_count": 12450
    }

def generate_mock_risk_distribution():
    return [
        {"risk_bucket": "0.00 (No Risk)", "transaction_count": 312450},
        {"risk_bucket": "0.01–0.25 (Low)", "transaction_count": 124550},
        {"risk_bucket": "0.26–0.50 (Medium)", "transaction_count": 50550},
        {"risk_bucket": "0.51–0.75 (High)", "transaction_count": 9950},
        {"risk_bucket": "0.76–1.00 (Critical)", "transaction_count": 2500}
    ]

def generate_mock_top_transactions():
    return [
        {
            "transaction_id": "EVT-98231",
            "timestamp": "2025-06-05T10:42:00",
            "account_id": "ACC-4932",
            "customer_id": "CUS-8392",
            "amount": 245000.00,
            "transaction_type": "Structuring",
            "merchant_category": "crypto",
            "country": "Nigeria",
            "fraud_flag": 1,
            "volatility_index": 3.24,
            "risk_score": 0.98
        },
        {
            "transaction_id": "EVT-87214",
            "timestamp": "2025-06-05T09:15:00",
            "account_id": "ACC-1902",
            "customer_id": "CUS-3904",
            "amount": 120500.00,
            "transaction_type": "Account Takeover",
            "merchant_category": "international",
            "country": "Iran",
            "fraud_flag": 1,
            "volatility_index": 2.85,
            "risk_score": 0.95
        },
        {
            "transaction_id": "EVT-77108",
            "timestamp": "2025-06-04T16:33:00",
            "account_id": "ACC-8394",
            "customer_id": "CUS-9204",
            "amount": 310000.00,
            "transaction_type": "Money Laundering",
            "merchant_category": "crypto",
            "country": "Myanmar",
            "fraud_flag": 1,
            "volatility_index": 3.12,
            "risk_score": 0.93
        },
        {
            "transaction_id": "EVT-65492",
            "timestamp": "2025-06-04T11:22:00",
            "account_id": "ACC-7382",
            "customer_id": "CUS-6102",
            "amount": 195000.00,
            "transaction_type": "Asset Layering",
            "merchant_category": "shell_company",
            "country": "Russia",
            "fraud_flag": 1,
            "volatility_index": 2.90,
            "risk_score": 0.89
        },
        {
            "transaction_id": "EVT-54210",
            "timestamp": "2025-06-03T15:10:00",
            "account_id": "ACC-6102",
            "customer_id": "CUS-5021",
            "amount": 85000.00,
            "transaction_type": "Smurfing",
            "merchant_category": "international",
            "country": "China",
            "fraud_flag": 1,
            "volatility_index": 2.45,
            "risk_score": 0.86
        },
        {
            "transaction_id": "EVT-43921",
            "timestamp": "2025-06-03T08:45:00",
            "account_id": "ACC-9204",
            "customer_id": "CUS-2045",
            "amount": 412000.00,
            "transaction_type": "Money Laundering",
            "merchant_category": "crypto",
            "country": "United Arab Emirates",
            "fraud_flag": 1,
            "volatility_index": 3.01,
            "risk_score": 0.84
        },
        {
            "transaction_id": "EVT-39045",
            "timestamp": "2025-06-02T18:20:00",
            "account_id": "ACC-4029",
            "customer_id": "CUS-1029",
            "amount": 63000.00,
            "transaction_type": "Structuring",
            "merchant_category": "international",
            "country": "Germany",
            "fraud_flag": 1,
            "volatility_index": 2.10,
            "risk_score": 0.81
        },
        {
            "transaction_id": "EVT-28490",
            "timestamp": "2025-06-02T13:14:00",
            "account_id": "ACC-3045",
            "customer_id": "CUS-9402",
            "amount": 145000.00,
            "transaction_type": "Asset Layering",
            "merchant_category": "shell_company",
            "country": "United Kingdom",
            "fraud_flag": 1,
            "volatility_index": 2.30,
            "risk_score": 0.78
        },
        {
            "transaction_id": "EVT-19024",
            "timestamp": "2025-06-01T10:05:00",
            "account_id": "ACC-2940",
            "customer_id": "CUS-7381",
            "amount": 28000.00,
            "transaction_type": "Smurfing",
            "merchant_category": "international",
            "country": "Singapore",
            "fraud_flag": 1,
            "volatility_index": 1.95,
            "risk_score": 0.75
        },
        {
            "transaction_id": "EVT-10294",
            "timestamp": "2025-06-01T09:12:00",
            "account_id": "ACC-1029",
            "customer_id": "CUS-3045",
            "amount": 92000.00,
            "transaction_type": "Account Takeover",
            "merchant_category": "international",
            "country": "United States",
            "fraud_flag": 1,
            "volatility_index": 2.20,
            "risk_score": 0.72
        }
    ]

def generate_mock_transaction_types():
    return [
        {"transaction_type": "card_purchase", "transaction_count": 200000, "avg_risk_score": 0.08},
        {"transaction_type": "transfer", "transaction_count": 100000, "avg_risk_score": 0.15},
        {"transaction_type": "wire", "transaction_count": 75000, "avg_risk_score": 0.32},
        {"transaction_type": "loan_payment", "transaction_count": 75000, "avg_risk_score": 0.12},
        {"transaction_type": "investment", "transaction_count": 50000, "avg_risk_score": 0.22}
    ]

def generate_mock_country_risk():
    return [
        {"country": "Nigeria", "transaction_count": 12450, "avg_risk_score": 0.82, "high_risk_count": 4500},
        {"country": "Myanmar", "transaction_count": 4320, "avg_risk_score": 0.78, "high_risk_count": 1200},
        {"country": "Iran", "transaction_count": 2150, "avg_risk_score": 0.91, "high_risk_count": 850},
        {"country": "Russia", "transaction_count": 8900, "avg_risk_score": 0.85, "high_risk_count": 3100},
        {"country": "China", "transaction_count": 45000, "avg_risk_score": 0.52, "high_risk_count": 6200},
        {"country": "US", "transaction_count": 225000, "avg_risk_score": 0.14, "high_risk_count": 1200},
        {"country": "Singapore", "transaction_count": 50000, "avg_risk_score": 0.18, "high_risk_count": 450},
        {"country": "India", "transaction_count": 125000, "avg_risk_score": 0.21, "high_risk_count": 1500},
        {"country": "UK", "transaction_count": 60000, "avg_risk_score": 0.15, "high_risk_count": 420}
    ]

def generate_mock_temporal_trend():
    months = [f"2025-{m:02d}" for m in range(1, 13)]
    counts = [38000, 39500, 41000, 40500, 42000, 41500, 43000, 42500, 44000, 43500, 44500, 40000]
    risk_scores = [0.15, 0.16, 0.17, 0.165, 0.18, 0.175, 0.19, 0.185, 0.21, 0.205, 0.22, 0.184]
    return [
        {"month": m, "transaction_count": c, "avg_risk_score": r}
        for m, c, r in zip(months, counts, risk_scores)
    ]

def generate_mock_graph_data():
    np.random.seed(101)
    num_txns = 150
    types = ["wire", "card_purchase", "loan_payment", "investment", "transfer"]
    countries = ["US", "India", "Singapore", "UK", "China", "Nigeria", "Myanmar", "Iran"]
    
    accounts = [f"ACC-{np.random.randint(1000, 9999)}" for _ in range(30)]
    customers = [f"CUS-{np.random.randint(1000, 9999)}" for _ in range(20)]
    
    data = []
    for i in range(num_txns):
        src = np.random.choice(accounts)
        cust = np.random.choice(customers)
        data.append({
            "transaction_id": f"TXN-{np.random.randint(10000000, 99999999)}",
            "timestamp": (pd.Timestamp("2025-06-15") - pd.Timedelta(hours=i*4)),
            "account_id": src,
            "customer_id": cust,
            "amount": float(np.round(np.random.uniform(1000, 80000), 2)),
            "transaction_type": np.random.choice(types),
            "country": np.random.choice(countries),
            "risk_score": float(np.round(np.random.uniform(0.0, 0.95), 4))
        })
    return pd.DataFrame(data)

# ──────────────────────────────────────────────
# CACHE STORE FOR BIGQUERY QUERIES
# ──────────────────────────────────────────────
_metrics_cache = None
_risk_by_channel_cache = None
_temporal_risk_cache = None
_geographical_risk_cache = None
_risk_distribution_cache = None
_critical_events_cache = None
_graph_raw_cache = None


@app.get("/api/metrics")
def get_metrics():
    global _metrics_cache
    if _metrics_cache is not None:
        return _metrics_cache
    if not bq_client:
        return generate_mock_summary()
    try:
        query = f"""
        SELECT
            COUNT(*) as total_transactions,
            SUM(CASE WHEN fraud_flag = 1 THEN 1 ELSE 0 END) as fraud_count,
            AVG(risk_score) as avg_risk_score,
            SUM(CASE WHEN risk_score >= 0.6 THEN 1 ELSE 0 END) as high_risk_count
        FROM `{PROJECT_ID}.elysium.transactions_enriched`
        """
        df = bq_client.query(query).to_dataframe()
        _metrics_cache = {
            "total_transactions": int(df['total_transactions'].iloc[0]),
            "fraud_count": int(df['fraud_count'].iloc[0] or 0),
            "avg_risk_score": float(df['avg_risk_score'].iloc[0] or 0),
            "high_risk_count": int(df['high_risk_count'].iloc[0] or 0)
        }
        return _metrics_cache
    except Exception as e:
        print(f"[ERROR] /api/metrics failed: {e}")
        traceback.print_exc()
        return generate_mock_summary()


@app.get("/api/risk-by-channel")
def get_risk_by_channel():
    global _risk_by_channel_cache
    if _risk_by_channel_cache is not None:
        return _risk_by_channel_cache
    if not bq_client:
        return generate_mock_transaction_types()
    try:
        query = f"""
        SELECT
            transaction_type,
            COUNT(*) as transaction_count,
            ROUND(AVG(risk_score), 4) as avg_risk_score
        FROM `{PROJECT_ID}.elysium.transactions_enriched`
        GROUP BY transaction_type
        ORDER BY transaction_count DESC
        """
        df = bq_client.query(query).to_dataframe()
        _risk_by_channel_cache = df.to_dict(orient="records")
        return _risk_by_channel_cache
    except Exception as e:
        print(f"[ERROR] /api/risk-by-channel failed: {e}")
        traceback.print_exc()
        return generate_mock_transaction_types()


@app.get("/api/temporal-risk")
def get_temporal_risk():
    global _temporal_risk_cache
    if _temporal_risk_cache is not None:
        return _temporal_risk_cache
    if not bq_client:
        return generate_mock_temporal_trend()
    try:
        query = f"""
        SELECT
            FORMAT_TIMESTAMP('%Y-%m', timestamp) as month,
            COUNT(*) as transaction_count,
            ROUND(AVG(risk_score), 4) as avg_risk_score
        FROM `{PROJECT_ID}.elysium.transactions_enriched`
        GROUP BY month
        ORDER BY month ASC
        """
        df = bq_client.query(query).to_dataframe()
        _temporal_risk_cache = df.to_dict(orient="records")
        return _temporal_risk_cache
    except Exception as e:
        print(f"[ERROR] /api/temporal-risk failed: {e}")
        traceback.print_exc()
        return generate_mock_temporal_trend()


@app.get("/api/geographical-risk")
def get_geographical_risk():
    global _geographical_risk_cache
    if _geographical_risk_cache is not None:
        return _geographical_risk_cache
    if not bq_client:
        return generate_mock_country_risk()
    try:
        query = f"""
        SELECT
            country,
            COUNT(*) as transaction_count,
            ROUND(AVG(risk_score), 4) as avg_risk_score,
            SUM(CASE WHEN risk_score >= 0.6 THEN 1 ELSE 0 END) as high_risk_count
        FROM `{PROJECT_ID}.elysium.transactions_enriched`
        GROUP BY country
        ORDER BY avg_risk_score DESC
        """
        df = bq_client.query(query).to_dataframe()
        _geographical_risk_cache = df.to_dict(orient="records")
        return _geographical_risk_cache
    except Exception as e:
        print(f"[ERROR] /api/geographical-risk failed: {e}")
        traceback.print_exc()
        return generate_mock_country_risk()


@app.get("/api/risk-distribution")
def get_risk_distribution():
    global _risk_distribution_cache
    if _risk_distribution_cache is not None:
        return _risk_distribution_cache
    if not bq_client:
        return generate_mock_risk_distribution()
    try:
        query = f"""
        SELECT
            CASE
                WHEN risk_score = 0 THEN '0.00 (No Risk)'
                WHEN risk_score > 0 AND risk_score <= 0.25 THEN '0.01–0.25 (Low)'
                WHEN risk_score > 0.25 AND risk_score <= 0.50 THEN '0.26–0.50 (Medium)'
                WHEN risk_score > 0.50 AND risk_score <= 0.75 THEN '0.51–0.75 (High)'
                ELSE '0.76–1.00 (Critical)'
            END AS risk_bucket,
            COUNT(*) AS transaction_count
        FROM `{PROJECT_ID}.elysium.transactions_enriched`
        GROUP BY risk_bucket
        ORDER BY risk_bucket
        """
        df = bq_client.query(query).to_dataframe()
        _risk_distribution_cache = df.to_dict(orient="records")
        return _risk_distribution_cache
    except Exception as e:
        print(f"[ERROR] /api/risk-distribution failed: {e}")
        traceback.print_exc()
        return generate_mock_risk_distribution()


@app.get("/api/critical-events")
def get_critical_events():
    global _critical_events_cache
    if _critical_events_cache is not None:
        return _critical_events_cache
    if not bq_client:
        return generate_mock_top_transactions()
    try:
        query = f"""
        SELECT
            transaction_id,
            timestamp,
            account_id,
            customer_id,
            amount,
            transaction_type,
            merchant_category,
            country,
            fraud_flag,
            volatility_index,
            risk_score
        FROM `{PROJECT_ID}.elysium.transactions_enriched`
        ORDER BY risk_score DESC, amount DESC
        LIMIT 10
        """
        df = bq_client.query(query).to_dataframe()
        # Convert Timestamp objects to string
        df['timestamp'] = df['timestamp'].dt.strftime('%Y-%m-%d %H:%M:%S')
        _critical_events_cache = df.to_dict(orient="records")
        return _critical_events_cache
    except Exception as e:
        print(f"[ERROR] /api/critical-events failed: {e}")
        traceback.print_exc()
        return generate_mock_top_transactions()


@app.get("/api/network-graph")
def get_network_graph(
    min_risk: float = Query(0.2, ge=0.0, le=1.0),
    max_edges: int = Query(150, ge=10, le=500)
):
    global _graph_raw_cache
    # Load dataset
    if not bq_client:
        df_graph_raw = generate_mock_graph_data()
    else:
        if _graph_raw_cache is not None:
            df_graph_raw = _graph_raw_cache
        else:
            try:
                query = f"""
                SELECT
                    transaction_id,
                    timestamp,
                    account_id,
                    customer_id,
                    amount,
                    transaction_type,
                    country,
                    risk_score
                FROM `{PROJECT_ID}.elysium.transactions_enriched`
                WHERE risk_score >= 0.2
                ORDER BY risk_score DESC
                LIMIT 300
                """
                df_graph_raw = bq_client.query(query).to_dataframe()
                _graph_raw_cache = df_graph_raw
            except Exception as e:
                print(f"[ERROR] /api/network-graph query failed: {e}")
                traceback.print_exc()
                df_graph_raw = generate_mock_graph_data()

    # Filter dataset based on inputs
    df_filtered = df_graph_raw[df_graph_raw['risk_score'] >= min_risk].head(max_edges)

    if df_filtered.empty:
        return {"nodes": [], "edges": [], "communities": []}

    # Build NetworkX graph
    G = nx.Graph()
    for _, row in df_filtered.iterrows():
        cust = row['customer_id']
        acc = row['account_id']
        
        if not G.has_node(cust):
            G.add_node(cust, label=cust, type='customer')
        if not G.has_node(acc):
            G.add_node(acc, label=acc, type='account')
            
        if G.has_edge(cust, acc):
            G[cust][acc]['weight'] += float(row['amount'])
            G[cust][acc]['risk'] = max(G[cust][acc]['risk'], float(row['risk_score']))
        else:
            G.add_edge(cust, acc, weight=float(row['amount']), risk=float(row['risk_score']))

    # Louvain Modularity Partitioning
    try:
        partition = community_louvain.best_partition(G)
    except Exception:
        partition = {node: 0 for node in G.nodes()}

    # Format nodes
    nodes = []
    comm_colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']
    for node, attrs in G.nodes(data=True):
        deg = G.degree(node)
        comm_id = partition.get(node, 0)
        color = comm_colors[comm_id % len(comm_colors)]
        nodes.append({
            "id": node,
            "label": node,
            "type": attrs.get("type", "customer"),
            "size": int(10 + (deg * 4)),
            "color": color,
            "community": comm_id,
            "degree": deg
        })

    # Format edges
    edges = []
    for u, v, edge_attrs in G.edges(data=True):
        val = abs(edge_attrs.get('weight', 1.0))
        width = float(1 + np.log1p(val) / 2)
        risk = edge_attrs.get('risk', 0.0)
        edge_color = "#f43f5e" if risk >= 0.5 else "#cbd5e1"
        edges.append({
            "from": u,
            "to": v,
            "weight": val,
            "width": width,
            "risk": risk,
            "color": edge_color
        })

    # Communities Risk Ledger Summary
    comm_summary = []
    for comm_id in set(partition.values()):
        nodes_in_comm = [n for n, cid in partition.items() if cid == comm_id]
        comm_txns = df_filtered[
            (df_filtered['account_id'].isin(nodes_in_comm)) | 
            (df_filtered['customer_id'].isin(nodes_in_comm))
        ]
        
        if not comm_txns.empty:
            avg_comm_risk = float(comm_txns['risk_score'].mean())
            total_comm_volume = float(comm_txns['amount'].abs().sum())
            comm_summary.append({
                "community_ring": f"Fraud Syndicate Ring #{comm_id}",
                "total_nodes": len(nodes_in_comm),
                "customer_entities": len([n for n in nodes_in_comm if n.startswith("CUS")]),
                "associated_bank_accounts": len([n for n in nodes_in_comm if n.startswith("ACC")]),
                "aggregate_volume": total_comm_volume,
                "vulnerability_risk_rating": avg_comm_risk
            })
            
    comm_summary = sorted(comm_summary, key=lambda x: x["vulnerability_risk_rating"], reverse=True)

    return {
        "nodes": nodes,
        "edges": edges,
        "communities": comm_summary
    }


class CopilotRequest(BaseModel):
    query: str


def get_mock_ai_response(query):
    query_lower = query.lower()
    if "wire" in query_lower:
        return """### 📋 Elysium Compliance Memo: International Wire Transfer Risks

Based on Elysium's transaction monitoring policy, international wire transfers present elevated risk profiles due to the following factors:

1. **Velocity Stacking:** Multiple transfers initiated to the same recipient corridor within a 24-hour window (threshold: $10,000 aggregate).
2. **Sanctioned Corridors:** High exposure to Tier 1 High-Risk countries (e.g., Myanmar, Iran, Russia) where strict Enhanced Due Diligence (EDD) is mandated.
3. **Mule Intermediaries:** Frequent routing through shell structures or newly registered entities acting as layering hubs.

**Recommended Actions:**
* Enforce 2-factor verification for transfers exceeding $50,000.
* Escalate any transactions with a country risk score > 7.0 directly to the AML Compliance Committee.

*Note: This is a simulated compliance response because GCP Application Default Credentials (ADC) were not found on this environment.*"""
    elif "kyc" in query_lower or "escalat" in query_lower:
        return """### 🔑 Elysium AML/KYC Escalation Protocol

Under Elysium's escalation policy, the standard escalation path is as follows:

1. **Level 1 (Analyst Review):** Triggered by initial system alerts (e.g., risk score ≥ 0.6). Analysts must verify customer identities and source of wealth within 48 hours.
2. **Level 2 (Compliance Officer Sign-off):** Required if verification documents are missing or if the entity is registered in a Tier 2 country. SLA: 5 business days.
3. **Level 3 (AML Committee / Board Review):** Ultimate authority for relationships involving PEPs (Politically Exposed Persons) or Tier 1 countries. SLA: 2 business days.

*Note: This is a simulated compliance response because GCP Application Default Credentials (ADC) were not found on this environment.*"""
    elif "credit" in query_lower or "warn" in query_lower:
        return """### 📉 Elysium Credit Risk Warnings

According to Elysium's credit policy, early warning signs of credit deterioration are categorized into three levels of priority:

1. **High Priority (Immediate Action):** 
   - Days Past Due (DPD) exceeding 30 days.
   - Sudden debt-to-equity ratio spike > 2.5x.
   - Material adverse change in primary supplier agreements.
2. **Medium Priority (Quarterly Review):**
   - Margin contraction of > 15% year-over-year.
   - Key management turnover (C-Suite resignations).
3. **Low Priority (Monitoring):**
   - Sector downgrades or industry macroeconomic downturns.

*Note: This is a simulated compliance response because GCP Application Default Credentials (ADC) were not found on this environment.*"""
    else:
        return f"""### 🔍 Elysium Risk Analysis

Thank you for your query: *"{query}"*. 

To retrieve grounded facts from the Elysium knowledge base using Gemini Pro and BigQuery Vector Search, please configure your Google Cloud Application Default Credentials (ADC).

*Note: This is a placeholder response because GCP credentials are currently missing.*"""


@app.post("/api/compliance-copilot")
def post_copilot(req: CopilotRequest):
    try:
        from model_router import ask_elysium
        answer, model_used = ask_elysium(req.query)
        return {"answer": answer, "model": model_used}
    except Exception as err:
        print(f"[ERROR] post_copilot failed: {err}")
        traceback.print_exc()
        return {
            "answer": get_mock_ai_response(req.query),
            "model": "Simulated Copilot (Local Mock)"
        }


# ──────────────────────────────────────────────
# STATIC FILES SERVING (React dist fallback)
# ──────────────────────────────────────────────
frontend_dist_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")

if os.path.exists(frontend_dist_path):
    app.mount("/", StaticFiles(directory=frontend_dist_path, html=True), name="frontend")
    
    @app.exception_handler(404)
    async def custom_404_handler(request, exc):
        # Fallback to index.html for SPAs (client routing)
        return FileResponse(os.path.join(frontend_dist_path, "index.html"))
else:
    @app.get("/")
    def read_root():
        return {"message": "FastAPI is running! Build React app under /frontend to serve frontend static content."}
