# Temporary Chat File RAG

Chat attachments remain conversation-local and temporary. Originals and image thumbnails live in GCS; safe metadata and bounded searchable chunks live under:

`batches/{batch_id}/chats/{chat_id}/attachments/{attachment_id}/chunks/{chunk_id}`

Chunks never contain bytes, base64, signed URLs, or GCS paths. Retrieval always filters trusted `batch_id`, `chat_id`, and `lecturer_id`. Images are searchable by their cached vision summary/OCR, but detailed visual questions still use the secured image-analysis tool. Nothing in this flow is promoted to Course Space or Vertex Search.

## Configuration

```env
CHAT_ATTACHMENT_RETENTION_DAYS=7
CHAT_FILE_RAG_ENABLED=true
CHAT_FILE_EMBEDDINGS_ENABLED=false
CHAT_FILE_EMBEDDING_MODEL=gemini-embedding-001
CHAT_FILE_EMBEDDING_DIMENSIONS=768
CHAT_FILE_RAG_MAX_EXTRACTED_CHARS=500000
CHAT_FILE_RAG_MAX_CHUNKS=150
CHAT_FILE_RAG_LEXICAL_FALLBACK=true
CHAT_FILE_OCR_ENABLED=false
CHAT_FILE_OCR_PROVIDER=document_ai
DOCUMENT_AI_OCR_PROCESSOR_NAME=
```

The code default for `CHAT_FILE_RAG_ENABLED` is `false`; production must opt in. Dimensions are clamped to 256–2048, retention to 1–30 days, and chunks to 150. Lexical retrieval remains available when embeddings or vector indexes fail.

## Firestore indexes

Deploy `firestore.indexes.json` for scoped lexical and maintenance queries. Firestore vector indexes are created separately. Create a collection-group cosine vector index for `chunks.embedding` with 768 dimensions and the equality/range filter fields `batch_id`, `chat_id`, `lecturer_id`, optional `attachment_id`, and `expires_at`. Use the index-creation command supplied by Firestore when the first `find_nearest` query reports a missing index, so it matches the deployed database and CLI version.

## OCR and cleanup

Native extraction always runs first. Optional Document AI OCR is limited to PDFs with fewer than 500 extracted characters or fewer than 100 characters per page. OCR failure preserves native chunks.

The hourly maintenance job—not Firestore TTL—extends attachment and chunk expiry for recently active chats and deletes expired GCS objects, chunks, then attachment metadata. Chat and batch deletion reuse the same idempotent cascade.
