# HackGT 13

# Prior Authorization Process

```mermaid
flowchart TD

    START([START])

    S1["STEP 1: DOCTOR PRESCRIBES OR ORDERS<br/><br/>
    Doctor determines that the patient needs a medication, test, procedure, or treatment.<br/><br/>
    Examples:<br/>
    • Prescription medication<br/>
    • MRI or CT scan<br/>
    • Surgery<br/>
    • Specialty medication<br/>
    • Certain medical devices"]

    S2["STEP 2: INSURANCE REQUIREMENT IS CHECKED<br/><br/>
    Pharmacy, hospital, doctor's office, or other provider submits information to the insurance company.<br/><br/>
    The insurance system checks whether prior authorization is required."]

    DECISION{"Is Prior Authorization<br/>Required?"}

    NORMAL["Claim follows<br/>normal process"]

    TREATMENT1["Treatment<br/>may proceed"]

    S3["STEP 3: PA REQUEST<br/><br/>
    Doctor's office submits request."]

    S4["STEP 4: DOCUMENTS<br/><br/>
    • Prior authorization form<br/>
    • Diagnosis<br/>
    • Medical history<br/>
    • Chart/office notes<br/>
    • Laboratory results<br/>
    • Imaging/X-rays<br/>
    • Previous treatments<br/>
    • Explanation of medical necessity"]

    S5["STEP 5: INSURANCE REVIEW<br/><br/>
    • Insurance checks the submitted information.<br/>
    • It may compare the request against its coverage rules.<br/>
    • It may determine whether the requested treatment meets its requirements.<br/>
    • More information may sometimes be requested."]

    S6["STEP 6: DECISION"]

    TIMELINE["TYPICAL DECISION TIMELINE<br/><br/>
    🟢 Standard request<br/>
    Up to about 7 calendar days<br/>
    for many applicable plans<br/><br/>
    🔴 Urgent / expedited request<br/>
    Up to about 72 hours<br/>
    for many applicable plans<br/><br/>
    ⚠️ Exact timeframe depends on the<br/>
    insurance plan, type of service,<br/>
    and applicable rules."]

    APPROVED{"APPROVED"}
    DENIED{"DENIED"}

    S7A["STEP 7A: TREATMENT CAN PROCEED<br/><br/>
    The requested treatment can proceed,<br/>
    subject to the plan's other requirements."]

    S7B["STEP 7B: APPEAL<br/><br/>
    Doctor/patient may request a review<br/>
    of the denial."]

    ADDITIONAL["Additional medical information<br/>may be submitted."]

    APPEAL["APPEAL DECISION"]

    A_APPROVED["APPROVED<br/><br/>
    Treatment proceeds"]

    A_DENIED["DENIED<br/><br/>
    Patient/provider may consider<br/>
    other available options"]

    COST["PATIENT COST<br/><br/>
    Approval does not necessarily mean<br/>
    the patient pays $0.<br/><br/>
    Patient may still have a deductible,<br/>
    copay, or coinsurance depending<br/>
    on the plan."]


    START --> S1
    S1 --> S2
    S2 --> DECISION

    DECISION -->|NO| NORMAL
    NORMAL --> TREATMENT1
    TREATMENT1 --> COST

    DECISION -->|YES| S3
    S3 --> S4
    S4 --> S5
    S5 --> S6

    S6 --> APPROVED
    S6 --> DENIED

    S6 -.-> TIMELINE

    APPROVED --> S7A
    S7A --> COST

    DENIED --> S7B
    S7B --> ADDITIONAL
    ADDITIONAL --> APPEAL

    APPEAL --> A_APPROVED
    APPEAL --> A_DENIED

    A_APPROVED --> COST
    A_DENIED --> COST


    classDef step fill:#1f2937,color:#ffffff,stroke:#9ca3af,stroke-width:2px;
    classDef decision fill:#374151,color:#ffffff,stroke:#d1d5db,stroke-width:2px;
    classDef timeline fill:#172554,color:#ffffff,stroke:#60a5fa,stroke-width:2px;
    classDef approved fill:#14532d,color:#ffffff,stroke:#4ade80,stroke-width:2px;
    classDef denied fill:#7f1d1d,color:#ffffff,stroke:#f87171,stroke-width:2px;
    classDef normal fill:#374151,color:#ffffff,stroke:#9ca3af,stroke-width:2px;
    classDef cost fill:#3f3f46,color:#ffffff,stroke:#facc15,stroke-width:2px;

    class S1,S2,S3,S4,S5,S6,S7A,S7B,ADDITIONAL,APPEAL,A_APPROVED,A_DENIED step;
    class DECISION decision;
    class TIMELINE timeline;
    class APPROVED,A_APPROVED approved;
    class DENIED,A_DENIED denied;
    class NORMAL,TREATMENT1 normal;
    class COST cost;
```
