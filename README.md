# Song Recorder

Phone-first web app for singing Tamil and Hindi songs karaoke-style and recording yourself on video.

## Step 1 (this version): add songs and remove vocals
- Upload an MP3/M4A from your phone (goes straight to Vercel Blob storage).
- Vocals are removed with the Demucs model on Replicate; the karaoke track is saved to Blob storage.
- Tick "already a karaoke track" to skip vocal removal.
- Your track list is kept on the phone (browser storage).

## Step 2: record yourself singing
- Paste static lyrics for each song (Tamil, Hindi or English letters).
- Tap Sing: front camera preview, lyrics over the video, 3-2-1 countdown.
- Music plays in your headphones and is mixed cleanly with your voice in the recording
  (music is delayed by the measured audio latency so voice and music line up).
- Music and voice volume sliders, a limiter to prevent distortion, and auto-stop at the end of the song.
- Records MP4 where the browser supports it (iPhone, recent Chrome), otherwise WebM.

## Setup
Environment variables:
- `BLOB_READ_WRITE_TOKEN`: added automatically when a Vercel Blob store is connected to the project.
- `REPLICATE_API_TOKEN`: from https://replicate.com/account/api-tokens (vocal removal costs a few cents per song).
- Optional `DEMUCS_MODEL` (default `ryan5453/demucs`) or `DEMUCS_VERSION` to pin a model version.

```bash
npm install
npm run dev
```
