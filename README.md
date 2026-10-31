# Song Recorder

Phone-first web app for singing Tamil and Hindi songs karaoke-style and recording yourself on video.

## Step 1 (this version): add songs and remove vocals
- Upload an MP3/M4A from your phone (goes straight to Vercel Blob storage).
- Vocals are removed with the Demucs model on Replicate; the karaoke track is saved to Blob storage.
- Tick "already a karaoke track" to skip vocal removal.
- Your track list is kept on the phone (browser storage).

## Setup
Environment variables:
- `BLOB_READ_WRITE_TOKEN`: added automatically when a Vercel Blob store is connected to the project.
- `REPLICATE_API_TOKEN`: from https://replicate.com/account/api-tokens (vocal removal costs a few cents per song).
- Optional `DEMUCS_MODEL` (default `ryan5453/demucs`) or `DEMUCS_VERSION` to pin a model version.

```bash
npm install
npm run dev
```
