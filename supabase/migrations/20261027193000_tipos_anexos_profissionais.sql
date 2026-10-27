-- HEIC/HEIF e arquivos cuja mídia não é identificada pelo navegador entram com MIME conhecido.
UPDATE storage.buckets SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/ogg', 'video/mp4', 'video/quicktime'
] WHERE id = 'professional-files';
