"""
Elysium AI — RAG Document Embedding Pipeline
===============================================
Reads documents from GCS, chunks them, generates embeddings via BigQuery ML,
and creates a vector index for similarity search.

Usage (Google Colab):
    Run this script after uploading RAG documents to GCS.
    Requires prior Colab authentication (done in generate_transactions.py).

GCP Config:
    PROJECT_ID  = "elysium-501518"
    BUCKET      = "elysium-data"
"""

import sys
import os
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

import re
import time
import google.auth
from google.cloud import bigquery, storage

# ──────────────────────────────────────────────
# CONFIG / GCP PROJECT RESOLUTION
# ──────────────────────────────────────────────
try:
    _, default_project = google.auth.default()
except Exception:
    default_project = None
PROJECT_ID = default_project or "elysium-501518"

BUCKET_NAME = "elysium-data"
GCS_RAG_PREFIX = "rag/"
BQ_RAG_DATASET = "rag"
BQ_EMBEDDINGS_TABLE = f"{PROJECT_ID}.{BQ_RAG_DATASET}.embeddings"
CHUNK_WORD_LIMIT = 300
EMBEDDING_MODEL = "text-embedding-004"

# ──────────────────────────────────────────────
# VERIFY GCP PROJECT
# ──────────────────────────────────────────────
print("=" * 60)
_, _project_id = google.auth.default()
print(f"   Active project: {_project_id}")
print("=" * 60)

bq_client = bigquery.Client(project=PROJECT_ID)
storage_client = storage.Client(project=PROJECT_ID)

# ──────────────────────────────────────────────
# STEP 1: Read documents from GCS
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 1: Reading documents from GCS...")
print("=" * 60)

bucket = storage_client.bucket(BUCKET_NAME)
blobs = list(bucket.list_blobs(prefix=GCS_RAG_PREFIX))
txt_blobs = [b for b in blobs if b.name.endswith(".txt")]

documents = []
for blob in txt_blobs:
    content = blob.download_as_text()
    filename = blob.name.split("/")[-1]
    documents.append({"filename": filename, "content": content})
    print(f"  📄 {filename} ({len(content.split())} words)")

print(f"\n✅ Loaded {len(documents)} documents from gs://{BUCKET_NAME}/{GCS_RAG_PREFIX}")

# ──────────────────────────────────────────────
# STEP 2: Chunk documents
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 2: Chunking documents (~300 words per chunk)...")
print("=" * 60)


def chunk_text(text, max_words=CHUNK_WORD_LIMIT):
    """Split text into chunks of approximately max_words words, breaking at paragraph boundaries."""
    paragraphs = re.split(r"\n\s*\n", text)
    chunks = []
    current_chunk = []
    current_word_count = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        para_words = len(para.split())

        if current_word_count + para_words > max_words and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk = [para]
            current_word_count = para_words
        else:
            current_chunk.append(para)
            current_word_count += para_words

    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return chunks


all_chunks = []
chunk_id = 0
for doc in documents:
    chunks = chunk_text(doc["content"])
    for chunk in chunks:
        all_chunks.append(
            {
                "chunk_id": f"chunk_{chunk_id:04d}",
                "content": chunk,
                "filename": doc["filename"],
            }
        )
        chunk_id += 1

print(f"✅ Created {len(all_chunks)} chunks from {len(documents)} documents")
for doc in documents:
    doc_chunks = [c for c in all_chunks if c["filename"] == doc["filename"]]
    print(f"   {doc['filename']}: {len(doc_chunks)} chunks")

# ──────────────────────────────────────────────
# STEP 3: Create staging table with chunk content
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 3: Creating staging table in BigQuery...")
print("=" * 60)

# Ensure dataset exists
try:
    bq_client.get_dataset(f"{PROJECT_ID}.{BQ_RAG_DATASET}")
except Exception:
    dataset = bigquery.Dataset(f"{PROJECT_ID}.{BQ_RAG_DATASET}")
    dataset.location = "us-central1"
    bq_client.create_dataset(dataset)
    print(f"   Created dataset: {BQ_RAG_DATASET}")

# Create staging table
staging_table = f"{PROJECT_ID}.{BQ_RAG_DATASET}.chunks_staging"

# Build INSERT values
create_staging_sql = f"""
CREATE OR REPLACE TABLE `{staging_table}` (
    chunk_id STRING,
    content STRING,
    filename STRING
)
"""
bq_client.query(create_staging_sql).result()

# Insert chunks in batches
import pandas as pd

chunks_df = pd.DataFrame(all_chunks)
job_config = bigquery.LoadJobConfig(
    write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
)
load_job = bq_client.load_table_from_dataframe(chunks_df, staging_table, job_config=job_config)
load_job.result()

table = bq_client.get_table(staging_table)
print(f"✅ Staging table created: {staging_table} ({table.num_rows} rows)")

# ──────────────────────────────────────────────
# STEP 4: Generate embeddings using BigQuery ML
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 4: Generating embeddings via ML.GENERATE_EMBEDDING...")
print("=" * 60)

t0 = time.time()

# First, create or replace the embedding model connection
# This uses the text-embedding-004 model
embedding_model_sql = f"""
CREATE OR REPLACE MODEL `{PROJECT_ID}.{BQ_RAG_DATASET}.embedding_model`
REMOTE WITH CONNECTION `{PROJECT_ID}.us-central1.elysium-connection`
OPTIONS (ENDPOINT = '{EMBEDDING_MODEL}')
"""

print("   Creating/updating embedding model...")
print(f"   ⚠️  NOTE: You need a BigQuery ML remote connection first.")
print(f"   If the model creation fails, create a connection named 'elysium-connection'")
print(f"   in BigQuery → Add → External Connection → Vertex AI.")
print()

try:
    bq_client.query(embedding_model_sql).result()
    print("   ✅ Embedding model created/updated")
except Exception as e:
    print(f"   ⚠️  Model creation note: {e}")
    print("   Continuing — model may already exist.")

# Generate embeddings
embed_sql = f"""
CREATE OR REPLACE TABLE `{BQ_EMBEDDINGS_TABLE}` AS
SELECT
    chunk_id,
    content,
    filename,
    ml_generate_embedding_result AS embedding,
    ml_generate_embedding_status AS embedding_status
FROM ML.GENERATE_EMBEDDING(
    MODEL `{PROJECT_ID}.{BQ_RAG_DATASET}.embedding_model`,
    (SELECT chunk_id, content, filename FROM `{staging_table}`),
    STRUCT(TRUE AS flatten_json_output, 'RETRIEVAL_DOCUMENT' AS task_type)
)
"""

print("   Generating embeddings (this may take 1-2 minutes)...")
bq_client.query(embed_sql).result()

t_embed = time.time() - t0

# Verify
table = bq_client.get_table(BQ_EMBEDDINGS_TABLE)
print(f"✅ Embeddings table created: {BQ_EMBEDDINGS_TABLE}")
print(f"   Rows: {table.num_rows}")
print(f"   Time: {t_embed:.2f}s")

# Check for errors
error_check = f"""
SELECT COUNT(*) as error_count
FROM `{BQ_EMBEDDINGS_TABLE}`
WHERE embedding_status != '' AND embedding_status IS NOT NULL
"""
errors = bq_client.query(error_check).to_dataframe()
error_count = errors["error_count"].iloc[0]
if error_count > 0:
    print(f"   ⚠️  {error_count} chunks had embedding errors")
else:
    print("   ✅ All chunks embedded successfully")

# ──────────────────────────────────────────────
# STEP 5: Create Vector Index
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 5: Creating vector index...")
print("=" * 60)

vector_index_sql = f"""
CREATE OR REPLACE VECTOR INDEX `embeddings_index`
ON `{BQ_EMBEDDINGS_TABLE}`(embedding)
OPTIONS (
    index_type = 'IVF',
    distance_type = 'COSINE',
    ivf_options = '{{"num_lists": 5}}'
)
"""

try:
    bq_client.query(vector_index_sql).result()
    print("✅ Vector index created successfully")
except Exception as e:
    print(f"   ⚠️  Vector index creation note: {e}")
    print("   Note: Vector index creation is asynchronous and may take a few minutes.")
    print("   The index will be built in the background. VECTOR_SEARCH will still work without it (just slower).")

# ──────────────────────────────────────────────
# STEP 6: Verification
# ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 6: Verification")
print("=" * 60)

verify_sql = f"""
SELECT chunk_id, filename, LEFT(content, 80) as content_preview
FROM `{BQ_EMBEDDINGS_TABLE}`
LIMIT 10
"""
sample = bq_client.query(verify_sql).to_dataframe()
print("   Sample rows from embeddings table:")
print(sample.to_string(index=False))

# Count by source file
count_sql = f"""
SELECT filename, COUNT(*) as chunk_count
FROM `{BQ_EMBEDDINGS_TABLE}`
GROUP BY filename
ORDER BY filename
"""
counts = bq_client.query(count_sql).to_dataframe()
print("\n   Chunks per document:")
print(counts.to_string(index=False))

print(f"\n🎉 PHASE 3b COMPLETE — RAG embedding pipeline finished!")
