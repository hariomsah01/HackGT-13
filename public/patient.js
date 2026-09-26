const form = document.getElementById("status-form");
const message = document.getElementById("message");
const result = document.getElementById("result");

function showMessage(text, type) {
  message.textContent = text;
  message.className = `alert ${type}`;
  message.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.classList.add("hidden");

  try {
    const response = await fetch("/api/patient/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientName: form.patientName.value,
        patientId: form.patientId.value,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showMessage(data.error || "Lookup failed.", "error");
      return;
    }

    const record = data.case;
    document.getElementById("status-banner").textContent = record.status;
    document.getElementById("out-name").textContent = record.patientName;
    document.getElementById("out-id").textContent = record.patientId;
    document.getElementById("out-age").textContent = String(record.patientAge);
    document.getElementById("out-doctor").textContent = record.doctorName;
    document.getElementById("out-date").textContent = new Date(record.submittedAt).toLocaleString();
    document.getElementById("out-info").textContent = record.medicalInfo || "None provided";
    const files = document.getElementById("out-files");
    files.innerHTML = "";
    if (!record.files.length) {
      const li = document.createElement("li");
      li.textContent = "No PDFs uploaded";
      files.appendChild(li);
    } else {
      for (const file of record.files) {
        const li = document.createElement("li");
        li.textContent = `${file.originalName} (${Math.ceil(file.size / 1024)} KB)`;
        files.appendChild(li);
      }
    }

    message.classList.add("hidden");
    result.classList.remove("hidden");
  } catch {
    showMessage("Could not reach the server.", "error");
  }
});
