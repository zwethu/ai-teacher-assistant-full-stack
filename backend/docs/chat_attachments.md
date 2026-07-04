# Chat Attachments (native-first)

Chat attachments are conversation-local and temporary. Originals and image
thumbnails live in GCS; safe metadata lives at
`batches/{batch_id}/chats/{chat_id}/attachments/{attachment_id}`. Nothing here is
promoted to Course Space or Vertex Search — to keep a file, promote it to the
batch's Course Space.

## How the agent reads them

The backend validates ownership once at run start and injects a **trusted
manifest** into agent session state (`agent_gateway.build_chat_attachment_context`).
The deployed agent reads documents **natively**: its `read_chat_attachment` tool
inserts the actual file (`gs://` URI) into the model request, so Gemini sees the
real content — tables, figures, scanned pages — rather than extracted text.
Images use a query-time vision tool. There is no chunk/embedding/vector pipeline.

DOCX/PPTX are not natively readable by Gemini: their full extracted text is
stored as a `text/plain` blob (`extracted_text_path`) and the manifest points the
native read there. PDFs, text files, and images point at the original upload.

See `/docs/temp-chat-attachments-native-redesign.md` (repo container) for the full
design and the cross-repo session-context contract.

## Configuration

```env
CHAT_ATTACHMENT_RETENTION_DAYS=7          # sent-attachment TTL (clamp 1-30)
CHAT_UNSENT_ATTACHMENT_GRACE_HOURS=24     # unsent-attachment TTL (clamp 1-168)
CHAT_ATTACHMENT_LEGACY_CONTEXT=true       # compat: legacy text context vs native summary lines
CHAT_ATTACHMENT_RECONCILE_ENFORCE=false   # weekly reconciliation: dry-run vs enforce
ATTACHMENT_VISION_MODEL=                  # set to enable upload-time image summaries
```

## Lifecycle & cleanup

- `attachment-cleanup` (hourly): hard TTL — expired attachments are deleted
  outright (no sliding extension). Unsent files die 24h after upload; sent files
  7 days after message association.
- `attachment-reconciliation` (weekly): sweeps orphans both directions (docs whose
  GCS object is gone, objects with no backing doc). Dry-run by default.
- Chat/batch deletion reuses the same idempotent cascade (blob + thumbnail +
  extracted-text blob + doc). A 30-day GCS lifecycle rule is the recommended
  backstop (operator-applied).
