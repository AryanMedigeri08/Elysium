"""
Elysium AI — Synthetic Transaction Data Generator
====================================================
Generates ~500,000 synthetic financial transactions and loads them into BigQuery.

Usage (Google Colab):
    Run each section as a separate notebook cell.
    This is the FIRST script to run — it handles Colab authentication.

GCP Config:
    PROJECT_ID  = "elysium-501518"
    BUCKET      = "gs://elysium-data/"
    BQ_TABLE    = "elysium.transactions_raw"
"""

import sys
import os
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

import google.auth

# ──────────────────────────────────────────────
# COLAB AUTHENTICATION (run this first if in Colab)
# ──────────────────────────────────────────────
try:
    from google.colab import auth
    auth.authenticate_user()
    print("✅ Authenticated in Google Colab context.")
except ImportError:
    pass

import numpy as np
import pandas as pd
import uuid
import time
from datetime import datetime, timedelta

# ──────────────────────────────────────────────
# CONFIG / GCP PROJECT RESOLUTION
# ──────────────────────────────────────────────
try:
    _, default_project = google.auth.default()
except Exception:
    default_project = None
PROJECT_ID = default_project or "elysium-501518"

BUCKET_NAME = "elysium-data"
BQ_DATASET = "elysium"
BQ_TABLE = f"{BQ_DATASET}.transactions_raw"
LOCAL_PARQUET = "transactions_raw.parquet"
NUM_ROWS = 500_000

np.random.seed(42)

# ──────────────────────────────────────────────
# VERIFY GCP PROJECT
# ──────────────────────────────────────────────
print("=" * 60)
_, _project_id = google.auth.default()
print(f"   Active project: {_project_id}")
print("=" * 60)

# ──────────────────────────────────────────────
# STEP 1: Generate synthetic data
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 1: Generating synthetic transaction data...")
print("=" * 60)

start_time = time.time()

# Date range: full year 2025, minute-level granularity
start_date = datetime(2025, 1, 1)
end_date = datetime(2025, 12, 31, 23, 59)
total_minutes = int((end_date - start_date).total_seconds() / 60)
random_minutes = np.random.randint(0, total_minutes, size=NUM_ROWS)
timestamps = [start_date + timedelta(minutes=int(m)) for m in random_minutes]

# Account and customer IDs
num_accounts = 5_000
num_customers = 4_200
account_ids = [f"ACC-{i:05d}" for i in range(num_accounts)]
customer_ids = [f"CUS-{i:05d}" for i in range(num_customers)]

# Transaction types
transaction_types = ["wire", "card_purchase", "loan_payment", "investment", "transfer"]
txn_type_weights = [0.15, 0.40, 0.15, 0.10, 0.20]

# Merchant categories
merchant_categories = ["retail", "international", "crypto", "supplier", "salary"]
merchant_weights = [0.35, 0.15, 0.08, 0.22, 0.20]

# Countries with realistic distribution
countries = ["US", "India", "Singapore", "UK", "China"]
country_weights = [0.45, 0.25, 0.10, 0.12, 0.08]

# Fraud flag: ~1.5% positive rate
fraud_rate = 0.015

# Build DataFrame
df = pd.DataFrame({
    "transaction_id": [str(uuid.uuid4()) for _ in range(NUM_ROWS)],
    "timestamp": timestamps,
    "account_id": np.random.choice(account_ids, size=NUM_ROWS),
    "customer_id": np.random.choice(customer_ids, size=NUM_ROWS),
    "amount": np.round(
        np.random.lognormal(mean=4.5, sigma=1.8, size=NUM_ROWS)
        * np.random.choice([1, -1], size=NUM_ROWS, p=[0.75, 0.25]),
        2,
    ),
    "transaction_type": np.random.choice(
        transaction_types, size=NUM_ROWS, p=txn_type_weights
    ),
    "merchant_category": np.random.choice(
        merchant_categories, size=NUM_ROWS, p=merchant_weights
    ),
    "country": np.random.choice(countries, size=NUM_ROWS, p=country_weights),
    "fraud_flag": np.random.choice(
        [0, 1], size=NUM_ROWS, p=[1 - fraud_rate, fraud_rate]
    ),
    "volatility_index": np.round(np.random.uniform(0.2, 3.5, size=NUM_ROWS), 4),
})

# Sort by timestamp for realism
df = df.sort_values("timestamp").reset_index(drop=True)

elapsed = time.time() - start_time
print(f"✅ Generated {len(df):,} rows in {elapsed:.2f}s")
print(f"\nColumn dtypes:\n{df.dtypes}\n")
print(f"Fraud rate: {df['fraud_flag'].mean():.4f} ({df['fraud_flag'].sum():,} fraudulent)")
print(f"\nSample rows:")
print(df.head(10).to_string(index=False))

# ──────────────────────────────────────────────
# STEP 2: Save to local Parquet
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 2: Saving to local Parquet file...")
print("=" * 60)

df.to_parquet(LOCAL_PARQUET, index=False, engine="pyarrow")
print(f"✅ Saved to {LOCAL_PARQUET}")

# ──────────────────────────────────────────────
# STEP 3: Upload to Cloud Storage
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 3: Upload to Cloud Storage")
print("=" * 60)

# Option A: Use gsutil (run this as a shell command in a notebook cell)
gsutil_cmd = f"gsutil cp {LOCAL_PARQUET} gs://{BUCKET_NAME}/"
print(f"Run this command in a notebook cell:")
print(f"  !{gsutil_cmd}")

# Option B: Use google-cloud-storage Python client
try:
    from google.cloud import storage

    storage_client = storage.Client(project=PROJECT_ID)
    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(LOCAL_PARQUET)
    blob.upload_from_filename(LOCAL_PARQUET)
    print(f"✅ Uploaded {LOCAL_PARQUET} to gs://{BUCKET_NAME}/{LOCAL_PARQUET}")
except Exception as e:
    print(f"⚠️  Python upload failed ({e}), use the gsutil command above instead.")

# ──────────────────────────────────────────────
# STEP 4: Load into BigQuery
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 4: Loading into BigQuery...")
print("=" * 60)

try:
    from google.cloud import bigquery

    bq_client = bigquery.Client(project=PROJECT_ID)

    # Configure load job
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.PARQUET,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )

    table_ref = f"{PROJECT_ID}.{BQ_TABLE}"

    load_job = bq_client.load_table_from_dataframe(
        df, table_ref, job_config=job_config
    )
    load_job.result()  # Wait for completion

    # Verify
    table = bq_client.get_table(table_ref)
    print(f"✅ Loaded into BigQuery: {table_ref}")
    print(f"   Rows: {table.num_rows:,}")
    print(f"   Schema: {[f.name for f in table.schema]}")

    # Quick verification query
    query = f"SELECT COUNT(*) as cnt, SUM(fraud_flag) as fraud_cnt FROM `{table_ref}`"
    result = bq_client.query(query).to_dataframe()
    print(f"\n   Verification: {result['cnt'].iloc[0]:,} total rows, {result['fraud_cnt'].iloc[0]:,} fraud cases")

except Exception as e:
    print(f"❌ BigQuery load failed: {e}")
    print("   Make sure the 'elysium' dataset exists in BigQuery and you have the right permissions.")

print("\n" + "=" * 60)
print("🎉 PHASE 1 COMPLETE — Data generation finished!")
print("=" * 60)
