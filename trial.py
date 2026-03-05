# trial.py – update all tiers with the new feature flag
import firebase_admin
from firebase_admin import credentials, firestore

# initialise with a service‑account JSON or application default creds
# cred = credentials.Certificate("/path/to/serviceAccount.json")
firebase_admin.initialize_app()          # uses ADC if run in Cloud Shell/container
db = firestore.client()

tiers = db.collection("tiers").stream()
for doc in tiers:
    print("updating", doc.id)
    doc.reference.update({"features.bq_export_page": True})