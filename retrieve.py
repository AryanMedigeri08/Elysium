"""
Elysium AI — Vector Search Retrieval Function
================================================
Retrieves relevant context from the RAG knowledge base using BigQuery VECTOR_SEARCH.

Usage:
    from retrieve import retrieve_context
    context, sources = retrieve_context("What are the risks with international wire transfers?")

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
from google.cloud import bigquery

# ──────────────────────────────────────────────
# CONFIG / GCP PROJECT RESOLUTION
# ──────────────────────────────────────────────
try:
    _, default_project = google.auth.default()
except Exception:
    default_project = None
PROJECT_ID = default_project or "elysium-501518"

BQ_RAG_DATASET = "rag"
BQ_EMBEDDINGS_TABLE = f"{PROJECT_ID}.{BQ_RAG_DATASET}.embeddings"
EMBEDDING_MODEL = f"{PROJECT_ID}.{BQ_RAG_DATASET}.embedding_model"

# ──────────────────────────────────────────────
# VERIFY GCP PROJECT
# ──────────────────────────────────────────────
print("=" * 60)
_, _project_id = google.auth.default()
print(f"   Active project: {_project_id}")
print("=" * 60)

bq_client = bigquery.Client(project=PROJECT_ID)


def retrieve_context(query: str, top_k: int = 5) -> tuple[str, list[str]]:
    """
    Retrieve the most relevant knowledge base chunks for a given query.

    Args:
        query: The user's question or search query.
        top_k: Number of top results to return (default: 5).

    Returns:
        A tuple of:
        - context_text: Concatenated content from the top_k most similar chunks.
        - source_files: List of source filenames that contributed to the context.
    """

    # Use VECTOR_SEARCH to find the most similar chunks
    # The query is embedded on-the-fly using the same embedding model
    search_sql = f"""
    SELECT
        base.chunk_id,
        base.content,
        base.filename,
        distance
    FROM VECTOR_SEARCH(
        TABLE `{BQ_EMBEDDINGS_TABLE}`,
        'embedding',
        (
            SELECT ml_generate_embedding_result AS embedding
            FROM ML.GENERATE_EMBEDDING(
                MODEL `{EMBEDDING_MODEL}`,
                (SELECT @query AS content),
                STRUCT(TRUE AS flatten_json_output, 'RETRIEVAL_QUERY' AS task_type)
            )
        ),
        top_k => @top_k,
        distance_type => 'COSINE'
    )
    ORDER BY distance ASC
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("query", "STRING", query),
            bigquery.ScalarQueryParameter("top_k", "INT64", top_k),
        ]
    )

    results = bq_client.query(search_sql, job_config=job_config).to_dataframe()

    if results.empty:
        return "No relevant context found in the knowledge base.", []

    # Concatenate chunk contents
    context_parts = []
    source_files = []
    for _, row in results.iterrows():
        context_parts.append(
            f"[Source: {row['filename']}]\n{row['content']}"
        )
        if row["filename"] not in source_files:
            source_files.append(row["filename"])

    context_text = "\n\n---\n\n".join(context_parts)

    return context_text, source_files


# ──────────────────────────────────────────────
# TEST
# ──────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("Testing retrieve_context()...")
    print("=" * 60)

    test_query = "What are the risks with international wire transfers?"
    print(f"\nQuery: \"{test_query}\"\n")

    context, sources = retrieve_context(test_query, top_k=5)

    print(f"Sources used: {sources}")
    print(f"\nRetrieved context ({len(context)} chars):")
    print("-" * 40)
    print(context[:2000])
    if len(context) > 2000:
        print(f"\n... [truncated, {len(context) - 2000} more chars]")
    print("-" * 40)

    # Second test
    test_query_2 = "What is the KYC escalation process?"
    print(f"\n\nQuery: \"{test_query_2}\"\n")

    context2, sources2 = retrieve_context(test_query_2, top_k=3)

    print(f"Sources used: {sources2}")
    print(f"\nRetrieved context ({len(context2)} chars):")
    print("-" * 40)
    print(context2[:1500])
    if len(context2) > 1500:
        print(f"\n... [truncated]")
    print("-" * 40)

    print("\n🎉 PHASE 3c COMPLETE — Retrieval function verified!")
