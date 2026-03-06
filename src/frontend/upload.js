async function handleUpload() {
  const fileInput = document.getElementById("fileUpload");
  const file = fileInput?.files?.[0];

  if (!file) {
    alert("Please select a file before uploading.");
    return;
  }

  const body = new FormData();
  body.append("epub", file);
  body.append("title", file.name);

  try {
    const response = await fetch("http://localhost:8080/api/files", {
      method: "POST",
      body,
    });

    if (response.ok) {
        window.location.reload();
    } else {
      alert(`Error ${response.status}: ${response.statusText}`);
    }
  } catch (err) {
    alert(`Failure: could not reach server`);
  }
}

const fileUpload = document.getElementById("fileUpload");
const uploadButton = document.getElementById("uploadButton");

fileUpload.addEventListener("change", () => {
  uploadButton.disabled = !fileUpload.files?.[0];
});

export function registerUploadButton() {
  document
    .getElementById("uploadButton")
    .addEventListener("click", handleUpload);
}
