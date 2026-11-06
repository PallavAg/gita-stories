# Gita Stories

A local website for finding, reviewing and fixing the stories told in recorded Gita classes. It transcribes each class with xAI speech-to-text, asks Grok to find the stories (with start/end times, a title and the shloka being explained), and gives you a player and editor to check and correct them.

## Setup

Needs Node.js 20+ and ffmpeg (`brew install ffmpeg`).

1. Put the recordings next to the `website` folder:
   - `Sunday Family Class Singapore Audio/*.mp3` (videos, optional: `Sunday Family Class Singapore/*.mp4`)
   - `Saturday Gita Class Audio/*.mp3` (videos, optional: `Saturday Gita Class/*.mp4`)
   - `audio/CHAPTER N/*.mp3`

   A video is matched to its audio by having the same file name.
2. Rename `website/.env.local.example` to `website/.env.local` and paste your xAI API key into it:
   ```
   XAI_API_KEY=xai-...
   ```
3. Install and start:
   ```bash
   cd website
   npm install
   npm run dev -- --port 3040
   ```
4. Open http://localhost:3040.

## Where things are saved

Stories, your edits and transcripts are saved as JSON in `stories/` next to the website. That folder is git-ignored, so it never leaves your computer and updates never touch it. The browser only remembers view settings.

## Updating

When there's new code on GitHub, an **Update** button appears in the top bar. It pulls the latest version and installs any new packages; if it says a restart is needed, stop the server and run `npm run dev` again.

## Sharing as a zip

Before zipping the folder, you can delete `website/node_modules` and `website/.next` to save space; both come back with `npm install` and `npm run dev`.
