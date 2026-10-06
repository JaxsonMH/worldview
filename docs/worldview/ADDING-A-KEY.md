# Adding a free key (fires, ships, …)

A few globe layers use services that are free but want you to sign up for a
key (a password-like code that identifies you). Without one, the layer shows
"Needs a free key".

| Layer | Service | Sign up (free) | Key name |
|---|---|---|---|
| Active fires | NASA FIRMS | https://firms.modaps.eosdis.nasa.gov/api/map_key/ (just your email) | `FIRMS_MAP_KEY` |
| Ships | AISStream | https://aisstream.io (sign in with GitHub, then "API Keys") | `AISSTREAM_API_KEY` |
| Air quality (PM2.5) | OpenAQ | https://explore.openaq.org/register, then your account page → "API Key" | `OPENAQ_API_KEY` |

The OpenAQ key can't be pasted into the Classic view; add it **by hand**
(below).

## Easiest: paste it into the app

1. Open http://localhost:4173/index.html (the **Classic view** link at the
   bottom of the globe's layer panel).
2. Click the **POWER UP** button (bottom right), find the service, paste
   your key, and save. It's stored in a file called `.env` in your
   `worldview` folder, which is never uploaded anywhere.
3. Go back to the Worldview globe and switch the layer on.

## By hand

Open the `worldview` folder in Finder, show hidden files (⌘-Shift-.), open
`.env` with TextEdit (create it if it's missing), add a line like

```
FIRMS_MAP_KEY=paste-your-key-here
```

save, then stop Worldview (Ctrl+C) and start it again with `./start.sh`.

Keys stay on your Mac: they live only in `.env`, and the app's server uses
them on your behalf, so they never reach the browser or git.
