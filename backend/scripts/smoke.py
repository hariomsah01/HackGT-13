import httpx

b = "http://127.0.0.1:8000"
c = httpx.Client(timeout=30)
print("health", c.get(f"{b}/api/health").json())
login = c.post(f"{b}/api/auth/login", json={"user_id": "doctor_a", "pin": "1111"}).json()
token = login["token"]
h = {"Authorization": f"Bearer {token}"}
patients = c.get(f"{b}/api/patients", headers=h).json()
print("patients", [p["label"] for p in patients])
pid = patients[0]["id"]
opened = c.get(f"{b}/api/patients/{pid}", headers=h).json()
print("opened", opened["patient"]["label"], "team", [m["label"] for m in opened["patient"]["team"]])
room = c.post(
    f"{b}/api/patients/{pid}/messages",
    headers=h,
    json={"text": "Doctor A here — reviewing shared chart with the team."},
).json()
print("messages", len(room["messages"]))
analytics = c.get(f"{b}/api/analytics", headers=h).json()
print("analytics totals", analytics["totals"])
pl = c.post(f"{b}/api/auth/login", json={"user_id": "patient_viewer", "pin": "0000"}).json()
summary = c.post(
    f"{b}/api/patients/{pid}/summary",
    headers={"Authorization": f"Bearer {pl['token']}"},
    json={"question": ""},
).json()
print("summary ok", summary["text"][:80])
