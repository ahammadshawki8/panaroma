# Panaroma

Panaroma is a small, single-page image library hosted on GitHub Pages. It uses a public repository for image files and a small JSON file for display names and virtual folders. There is no database or separate server.

## What it does

- Upload PNG, JPG, GIF, WebP, and AVIF images, up to 20 MB each.
- Create virtual folders, rename images, and move images between folders.
- Copy direct image links, Markdown, or HTML snippets.
- Keep each image at a fixed `files/<id>.<extension>` path, so renaming or moving it does not change its embed URL.
- Delete an image when you no longer need it. Deleting an image breaks its embed URL.

## Connect GitHub

The public page can display the library without signing in. To make changes, create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with these settings:

1. Resource owner: `ahammadshawki8`.
2. Repository access: only `panaroma`.
3. Repository permissions: **Contents: Read and write**. GitHub adds Metadata read access automatically.

Open the site, select **Connect GitHub**, and paste the token. The app checks the GitHub account and repository before saving it in this browser's local storage. You do not need to grant permission for every action. Disconnect removes the token from this browser. Never put a token into this repository, a screenshot, or a shared link.

The app makes requests directly from your browser to GitHub's API. GitHub Pages does not run a backend. On a different browser or after clearing browser storage, you will need to connect again. If your token expires or is revoked, create a new one and reconnect.

## How links work

An image is stored at a path such as `files/4f6c....png`. Its public link is:

```text
https://ahammadshawki8.github.io/panaroma/files/4f6c....png
```

The display name and folder live in [`data/library.json`](data/library.json). They are metadata, not physical directories. Editing them creates a small commit but does not move the image. New uploads can take a minute to appear at their public URL while GitHub Pages publishes the latest commit.

## Hosting and limits

The site is published from the `main` branch at the repository root. GitHub Pages does not impose an expiry on a normal static file URL, but does not guarantee a fixed number of years of availability. Keep a backup of the repository if long-term access matters.

GitHub Pages limits a published site to 1 GB and has a soft 100 GB per month bandwidth limit. Git LFS files are not served by Pages. Panaroma applies its own 20 MB per image limit to keep uploads responsive in a browser.

## Local checks

Run `npm test` for the core file and link checks. Open `index.html` through a local static server to preview the page. The GitHub API actions need a valid token and the published repository.
