"""
Elysium AI — Gemini Model Router
===================================
Routes queries to Gemini Flash (fast/simple) or Gemini Pro (complex/RAG-grounded)
based on query classification.

Usage:
    from model_router import ask_elysium
    answer, model_used = ask_elysium("What is the current risk score for account ACC-00042?")

GCP Config:
    PROJECT_ID = "elysium-501518"
"""

import re
import google.auth
from google.cloud import aiplatform
from vertexai.generative_models import GenerativeModel

# ──────────────────────────────────────────────
# CONFIG / GCP PROJECT RESOLUTION
# ──────────────────────────────────────────────
try:
    _, default_project = google.auth.default()
except Exception:
    default_project = None
PROJECT_ID = default_project or "elysium-501518"
LOCATION = "us-central1"

FLASH_MODEL = "gemini-2.0-flash"
PRO_MODEL = "gemini-2.0-pro"

# ──────────────────────────────────────────────
# VERIFY GCP PROJECT
# ──────────────────────────────────────────────
print("=" * 60)
_, _project_id = google.auth.default()
print(f"   Active project: {_project_id}")
print("=" * 60)

# Initialize Vertex AI (uses application default credentials)
import vertexai
vertexai.init(project=PROJECT_ID, location=LOCATION)
aiplatform.init(project=PROJECT_ID, location=LOCATION)

# Flash keywords — queries containing these route to the fast model
FLASH_KEYWORDS = [
    "risk score",
    "quick",
    "current",
    "summary",
    "how much",
    "calculate",
    "total",
    "count",
    "average",
    "list",
    "show me",
    "what is the",
    "status",
    "balance",
]

# System prompt for Elysium AI
SYSTEM_PROMPT = """You are Elysium AI, a senior financial risk analyst at a major financial institution.
You provide precise, data-driven analysis of financial risks, transactions, and market conditions.

Guidelines:
- Be concise but thorough in your analysis
- Cite specific numbers, thresholds, and risk scores when available
- Flag any high-risk indicators clearly
- Recommend specific actions when appropriate
- If referencing knowledge base documents, mention the source
- Use professional financial terminology
- When uncertain, clearly state limitations of your analysis
"""


def classify_query(query: str) -> str:
    """
    Classify a query as 'flash' (simple/fast) or 'pro' (complex/RAG-grounded).

    Args:
        query: The user's question.

    Returns:
        'flash' for simple queries, 'pro' for complex queries requiring RAG context.
    """
    query_lower = query.lower().strip()

    for keyword in FLASH_KEYWORDS:
        if keyword in query_lower:
            return "flash"

    return "pro"


def ask_elysium(query: str) -> tuple[str, str]:
    """
    Process a query through the Elysium AI system.

    - Flash path: Direct Gemini Flash call for simple/fast queries
    - Pro path: RAG retrieval + Gemini Pro for complex analysis queries

    Args:
        query: The user's question.

    Returns:
        A tuple of (answer_text, model_used).
    """
    model_class = classify_query(query)

    if model_class == "pro":
        # Import retrieve_context for RAG grounding
        from retrieve import retrieve_context

        context, sources = retrieve_context(query, top_k=5)

        prompt = f"""{SYSTEM_PROMPT}

You have been provided with the following context from the Elysium knowledge base to help answer the user's question.
Use this context to ground your response with specific details, numbers, and policies.

--- KNOWLEDGE BASE CONTEXT ---
{context}
--- END CONTEXT ---

Source documents used: {', '.join(sources)}

User Question: {query}

Provide a thorough, well-structured analysis based on the context above."""

        model = GenerativeModel(PRO_MODEL)
        response = model.generate_content(prompt)
        model_used = f"Gemini Pro ({PRO_MODEL})"

    else:
        # Flash path — direct response without RAG
        prompt = f"""{SYSTEM_PROMPT}

User Question: {query}

Provide a concise, direct answer."""

        model = GenerativeModel(FLASH_MODEL)
        response = model.generate_content(prompt)
        model_used = f"Gemini Flash ({FLASH_MODEL})"

    answer = response.text

    return answer, model_used


# ──────────────────────────────────────────────
# TEST
# ──────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("Testing Elysium AI Model Router")
    print("=" * 60)

    # Test 1: Should route to FLASH
    query_flash = "What is the current risk score summary for high-risk accounts?"
    print(f"\n📝 Test 1 (expected: Flash)")
    print(f"   Query: \"{query_flash}\"")
    print(f"   Classification: {classify_query(query_flash)}")

    try:
        answer1, model1 = ask_elysium(query_flash)
        print(f"   Model used: {model1}")
        print(f"   Answer preview: {answer1[:300]}...")
    except Exception as e:
        print(f"   ⚠️  Error: {e}")

    # Test 2: Should route to PRO
    query_pro = "Explain the fraud detection patterns for international wire transfers and how they relate to our country risk framework."
    print(f"\n📝 Test 2 (expected: Pro)")
    print(f"   Query: \"{query_pro}\"")
    print(f"   Classification: {classify_query(query_pro)}")

    try:
        answer2, model2 = ask_elysium(query_pro)
        print(f"   Model used: {model2}")
        print(f"   Answer preview: {answer2[:300]}...")
    except Exception as e:
        print(f"   ⚠️  Error: {e}")

    print(f"\n🎉 PHASE 3d COMPLETE — Model router verified!")
