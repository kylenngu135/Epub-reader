package main

import (
	"fmt"
	"log"
	"net/http"
	"mime"

	"epub-reader/api"
	"epub-reader/middleware"
)

func main() {
	// adds javascript extension type
	mime.AddExtensionType(".js", "application/javascript")

	// static server for hosting on localhost:8080
	fs_ui := http.FileServer(http.Dir("../ui"))
	fs_frontend := http.FileServer(http.Dir("../frontend"))
	fs_storage := http.FileServer(http.Dir("../../storage/media/"))
	http.Handle("/", fs_ui)
	http.Handle("/frontend/", http.StripPrefix("/frontend/", fs_frontend))
	http.Handle("/storage/", http.StripPrefix("/storage/", fs_storage))

	// handle api/files endpoint
	http.HandleFunc("/api/files", api.FilesHandler)

	// enable cors
	fmt.Println("Server running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", middleware.EnableCORS(http.DefaultServeMux)))
}
