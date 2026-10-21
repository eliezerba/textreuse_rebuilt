# GitHub Pages deployment

This folder is already a complete static site. No build step is required.

## Fastest route

1. Upload **all files and folders in this directory** to the root of a GitHub repository.
2. In the repository open **Settings -> Pages**.
3. Under **Build and deployment**, choose **GitHub Actions**.
4. Push to `main` (or run the included workflow manually).

The included `.github/workflows/deploy-pages.yml` publishes the folder as-is.

## Included data

Static hosting cannot discover directory contents by itself, so the viewer uses `data/manifest.json` to know which JSON files are packaged with the site. This V5.1 distribution intentionally has an empty manifest because the supplied repository ZIP did not contain publishable research data. Add your own datasets to data/ and regenerate the manifest, or load files from the browser.

When adding another `.json`, `.jsonl`, or `.ndjson` file for publication:

1. Put it inside `data/`.
2. Run `python build_manifest.py`.
3. Commit both the data file and the updated `data/manifest.json`.

Local file selection from the browser remains available even when a file is not in the manifest.

## Repository size note

GitHub normally rejects individual files larger than 100 MB in a regular Git repository. Very large research datasets should therefore be hosted separately and loaded through the remote-source mechanism rather than committed directly to the Pages repository.
