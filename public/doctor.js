const form = document.getElementById("case-form");
const message = document.getElementById("message");

function showMessage(text, type) {
  message.textContent = text;
  message.className = `alert ${type}`;
  message.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = form.pdfs.files;
  if (files.length > 10) {
    showMessage("You can upload at most 10 PDF files.", "error");
    return;
  }
  for (const file of files) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      showMessage("Only PDF files are allowed.", "error");
      return;
    }
  }

  const body = new FormData(form);
  showMessage("Submitting case...", "ok");

  try {
    const response = await fetch("/api/cases", {
      method: "POST",
      body,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showMessage(data.error || "Submit failed.", "error");
      return;
    }
    showMessage(
      `Case submitted. ${data.case.files.length} PDF(s) saved. Patient can now check status.`,
      "ok"
    );
    form.reset();
  } catch {
    showMessage("Could not reach the server.", "error");
  }
});
