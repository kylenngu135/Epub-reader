package api 

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// bookEntry is the JSON shape returned to the frontend.
type bookEntry struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	CoverURL string `json:"coverUrl"`
	FileURL  string `json:"fileUrl"`
}

// ListFilesHandler handles GET /api/files.
// It scans the storage directory for .epub files and returns metadata for each.
func ListFilesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	storageDir := storageDirectory()

	entries, err := os.ReadDir(storageDir)
	if err != nil {
		if os.IsNotExist(err) {
			// No storage dir yet — return an empty list rather than an error.
			writeJSON(w, []bookEntry{})
			return
		}
		http.Error(w, "failed to read storage directory", http.StatusInternalServerError)
		return
	}

	books := make([]bookEntry, 0)

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		if !strings.EqualFold(filepath.Ext(name), ".epub") {
			continue
		}

		stem := strings.TrimSuffix(name, filepath.Ext(name))

		// Derive a stable ID from the filename stem.
		id := sanitiseID(stem)

		// Check whether a cover file exists alongside the epub.
		// Convention (from UploadEpubHandler): <stem>_cover
		coverURL := ""
		coverPath := filepath.Join(storageDir, stem+"_cover")
		if _, err := os.Stat(coverPath); err == nil {
			coverURL = fmt.Sprintf("/storage/%s_cover", stem)
		}

		books = append(books, bookEntry{
			ID:       id,
			Title:    stem,
			CoverURL: coverURL,
			FileURL:  fmt.Sprintf("/storage/%s", name),
		})
	}

	writeJSON(w, books)
}

// storageDirectory returns the path to the epub storage folder.
// Override with the STORAGE_DIR environment variable for production.
func storageDirectory() string {
	if dir := os.Getenv("STORAGE_DIR"); dir != "" {
		return dir
	}
	return "../../storage/media/"
}

// sanitiseID converts a filename stem into a URL-safe identifier.
func sanitiseID(stem string) string {
	replacer := strings.NewReplacer(" ", "-", "_", "-")
	return strings.ToLower(replacer.Replace(stem))
}

// writeJSON marshals v and writes it as an application/json response.
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}
