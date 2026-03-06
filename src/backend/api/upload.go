package api 

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// fileRequest holds the metadata and content of an uploaded epub file.
type fileRequest struct {
	Title    string
	Contents []byte
	Cover    []byte
}

// UploadEpubHandler handles POST requests to upload an .epub file.
// It expects a multipart form with:
//   - "title"    — the book title (string field)
//   - "epub"     — the .epub file
//   - "cover"    — the cover image file (optional)
func UploadEpubHandler(w http.ResponseWriter, r *http.Request) {
	// Only accept POST
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Limit upload size to 50 MB (adjust as needed)
	const maxUploadSize = 50 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		http.Error(w, "request body too large or malformed", http.StatusBadRequest)
		return
	}

	// ── 1. Title ────────────────────────────────────────────────────────────
	title := strings.TrimSpace(r.FormValue("title"))
	if title == "" {
		http.Error(w, "title is required", http.StatusBadRequest)
		return
	}

	// ── 2. EPUB file ────────────────────────────────────────────────────────
	epubFile, epubHeader, err := r.FormFile("epub")
	if err != nil {
		http.Error(w, "epub file is required", http.StatusBadRequest)
		return
	}
	defer epubFile.Close()

	// Validate .epub extension
	if !strings.EqualFold(filepath.Ext(epubHeader.Filename), ".epub") {
		http.Error(w, "invalid file type: only .epub files are accepted", http.StatusUnsupportedMediaType)
		return
	}

	epubContents, err := io.ReadAll(epubFile)
	if err != nil {
		http.Error(w, "failed to read epub file", http.StatusInternalServerError)
		return
	}

	// ── 3. Cover image (optional) ───────────────────────────────────────────
	var coverContents []byte
	coverFile, _, err := r.FormFile("cover")
	if err == nil {
		defer coverFile.Close()
		coverContents, err = io.ReadAll(coverFile)
		if err != nil {
			http.Error(w, "failed to read cover file", http.StatusInternalServerError)
			return
		}
	}
	// If no cover was provided, coverContents remains nil — that is fine.

	// ── 4. Populate struct ──────────────────────────────────────────────────
	req := fileRequest{
		Title:    title,
		Contents: epubContents,
		Cover:    coverContents,
	}

	// ── 5. Write epub to storage ────────────────────────────────────────────
	if err := saveToStorage(req, epubHeader.Filename); err != nil {
		http.Error(w, fmt.Sprintf("failed to save file: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	fmt.Fprintf(w, "epub %q uploaded successfully", req.Title)
	return
}

// saveToStorage persists the epub contents to the local filesystem.
// Replace or extend this function to write to S3, GCS, a database, etc.
func saveToStorage(req fileRequest, originalFilename string) error {
	const storageDir = "../../storage/media"

	if err := os.MkdirAll(storageDir, 0o755); err != nil {
		return fmt.Errorf("create storage directory: %w", err)
	}

	// Use the original filename; sanitise to prevent path traversal.
	safeName := filepath.Base(originalFilename)
	destPath := filepath.Join(storageDir, safeName)

	if err := os.WriteFile(destPath, req.Contents, 0o644); err != nil {
		return fmt.Errorf("write epub file: %w", err)
	}

	// Optionally persist the cover alongside the epub.
	if len(req.Cover) > 0 {
		coverPath := filepath.Join(storageDir, strings.TrimSuffix(safeName, ".epub")+"_cover")
		if err := os.WriteFile(coverPath, req.Cover, 0o644); err != nil {
			return fmt.Errorf("write cover file: %w", err)
		}
	}

	return nil
}
