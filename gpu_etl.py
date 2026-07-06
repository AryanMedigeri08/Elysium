"""
Elysium AI — GPU-Accelerated ETL Pipeline
=============================================
Enriches raw transaction data with rolling averages and risk scores using RAPIDS cuDF.

Usage (Google Colab with GPU runtime):
    Run this script after generate_transactions.py has loaded data into BigQuery.
    Ensure Colab runtime is set to GPU (T4).

GCP Config:
    PROJECT_ID = "elysium-501518"
"""

import sys
import os
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

import google.auth

# ──────────────────────────────────────────────
# INSTALL RAPIDS cuDF (Colab doesn't have it pre-installed)
# ──────────────────────────────────────────────
try:
    from google.colab import auth
    IN_COLAB = True
except ImportError:
    IN_COLAB = False

if IN_COLAB:
    import subprocess
    print("=" * 60)
    print("STEP 0: Installing RAPIDS cuDF for GPU acceleration...")
    print("=" * 60)
    subprocess.run(
        ["pip", "install", "cudf-cu12", "--extra-index-url=https://pypi.nvidia.com", "--break-system-packages"],
        check=True,
    )
    print("✅ cuDF installed successfully")

# ──────────────────────────────────────────────
# ENABLE cuDF-accelerated pandas (with CPU fallback)
# ──────────────────────────────────────────────
# Using the programmatic equivalent of %load_ext cudf.pandas
# so this works when run as a plain script (not just in a notebook cell)
try:
    import cudf.pandas
    cudf.pandas.install()
    print("⚡ RAPIDS cuDF GPU acceleration enabled!")
except ImportError:
    print("ℹ️ cuDF is not installed or GPU is not available. Falling back to CPU execution using standard pandas.")

import time
import pandas as pd

# ──────────────────────────────────────────────
# CONFIG / GCP PROJECT RESOLUTION
# ──────────────────────────────────────────────
try:
    _, default_project = google.auth.default()
except Exception:
    default_project = None
PROJECT_ID = default_project or "elysium-501518"

BQ_SOURCE = f"{PROJECT_ID}.elysium.transactions_raw"
BQ_DEST = f"{PROJECT_ID}.elysium.transactions_enriched"

# ──────────────────────────────────────────────
# VERIFY GCP PROJECT
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
_, _project_id = google.auth.default()
print(f"   Active project: {_project_id}")
print("=" * 60)

# ──────────────────────────────────────────────
# STEP 1: Load data from BigQuery
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 1: Loading data from BigQuery...")
print("=" * 60)

from google.cloud import bigquery

bq_client = bigquery.Client(project=PROJECT_ID)

query = f"""
SELECT *
FROM `{BQ_SOURCE}`
ORDER BY account_id, timestamp
"""

t0 = time.time()
df = bq_client.query(query).to_dataframe(bool_dtype=None, int_dtype=None, float_dtype=None)
t_load = time.time() - t0

print(f"✅ Loaded {len(df):,} rows in {t_load:.2f}s")
print(f"   Columns: {list(df.columns)}")
print(f"   Memory usage: {df.memory_usage(deep=True).sum() / 1e6:.1f} MB")

# ──────────────────────────────────────────────
# STEP 2: Sort and compute rolling average
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 2: Computing rolling averages (GPU-accelerated)...")
print("=" * 60)

t1 = time.time()

# Sort by account_id and timestamp
df = df.sort_values(["account_id", "timestamp"]).reset_index(drop=True)

# Rolling 50-transaction average of amount per account_id
df["rolling_avg_amount"] = (
    df.groupby("account_id")["amount"]
    .transform(lambda x: x.rolling(window=50, min_periods=1).mean())
)

t_rolling = time.time() - t1
print(f"✅ Rolling average computed in {t_rolling:.2f}s")
print(f"   Sample rolling_avg_amount values:")
print(f"   {df['rolling_avg_amount'].describe()}")

# ──────────────────────────────────────────────
# STEP 3: Compute composite risk_score
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 3: Computing risk scores...")
print("=" * 60)

t2 = time.time()

# Component 1: Volatility flag (weight 0.40)
# volatility_index > 1.5 is considered elevated
volatility_flag = (df["volatility_index"] > 1.5).astype(float)

# Component 2: Amount deviation flag (weight 0.35)
# Amount deviating > 3x from rolling average
amount_deviation = (df["amount"].abs() > 3.0 * df["rolling_avg_amount"].abs()).astype(float)

# Component 3: Fraud flag (weight 0.25)
fraud_component = df["fraud_flag"].astype(float)

# Composite risk score
df["risk_score"] = (
    0.40 * volatility_flag
    + 0.35 * amount_deviation
    + 0.25 * fraud_component
)

# Round for cleanliness
df["risk_score"] = df["risk_score"].round(4)

t_risk = time.time() - t2
print(f"✅ Risk scores computed in {t_risk:.2f}s")
print(f"\n   Risk score distribution:")
print(f"   {df['risk_score'].describe()}")
print(f"\n   Risk score value counts:")
print(f"   {df['risk_score'].value_counts().head(10)}")

# ──────────────────────────────────────────────
# STEP 4: Summary statistics
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 4: Summary statistics")
print("=" * 60)

high_risk = df[df["risk_score"] >= 0.6]
print(f"   Total rows: {len(df):,}")
print(f"   High risk (score ≥ 0.6): {len(high_risk):,} ({100*len(high_risk)/len(df):.2f}%)")
print(f"   Fraud cases: {df['fraud_flag'].sum():,}")
print(f"   Avg risk score: {df['risk_score'].mean():.4f}")
print(f"   Max risk score: {df['risk_score'].max():.4f}")

print(f"\n   Top 5 highest-risk transactions:")
print(df.nlargest(5, "risk_score")[
    ["transaction_id", "account_id", "amount", "volatility_index", "fraud_flag", "risk_score"]
].to_string(index=False))

# ──────────────────────────────────────────────
# STEP 5: Write enriched data to BigQuery
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 5: Writing enriched data to BigQuery...")
print("=" * 60)

t3 = time.time()

job_config = bigquery.LoadJobConfig(
    write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
)

load_job = bq_client.load_table_from_dataframe(
    df, BQ_DEST, job_config=job_config
)
load_job.result()  # Wait for completion

t_write = time.time() - t3

# Verify
table = bq_client.get_table(BQ_DEST)
print(f"✅ Written to BigQuery: {BQ_DEST}")
print(f"   Rows: {table.num_rows:,}")
print(f"   Write time: {t_write:.2f}s")

# ──────────────────────────────────────────────
# TIMING SUMMARY (for demo)
# ──────────────────────────────────────────────
total_time = t_load + t_rolling + t_risk + t_write
print("\n" + "=" * 60)
print("⏱️  GPU ETL TIMING SUMMARY")
print("=" * 60)
print(f"   Data load:       {t_load:.2f}s")
print(f"   Rolling average: {t_rolling:.2f}s")
print(f"   Risk scoring:    {t_risk:.2f}s")
print(f"   BigQuery write:  {t_write:.2f}s")
print(f"   ─────────────────────────")
print(f"   TOTAL:           {total_time:.2f}s")
print(f"\n🎉 PHASE 3a COMPLETE — GPU ETL pipeline finished!")
