package api 

import (
	"net/http"
)

// FilesHandler routes /api/files requests to the appropriate handler
// based on the HTTP method.
func FilesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		ListFilesHandler(w, r)
	case http.MethodPost:
		UploadEpubHandler(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
