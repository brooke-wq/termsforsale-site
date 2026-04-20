# TFS Buyer Lifecycle — Flow Diagrams

Two views of the same system: the 30-second version and the whole map.

---

## Happy Path (30-second read)

What a healthy deal looks like from seller lead to closed assignment.

```mermaid
flowchart LR
    A[Brooke marks deal<br/>Actively Marketing in Notion] --> B[n8n bridge polls<br/>every 10 min]
    B --> C[Match engine filters<br/>active buyers on<br/>asset class + market + price]
    C --> D[GHL WF02 sends SMS + email<br/>A now · B +1h · C +4h]
    D --> E[Buyer replies<br/>Eddie gets task]
    E --> F[Deal closes<br/>WF03 upgrades buyer to VIP]

    classDef operator fill:#F7941D,stroke:#0D1F3C,color:#fff,stroke-width:2px
    classDef automated fill:#29ABE2,stroke:#0D1F3C,color:#fff,stroke-width:2px
    classDef outcome fill:#10B981,stroke:#0D1F3C,color:#fff,stroke-width:2px

    class A,E operator
    class B,C,D automated
    class F outcome
```

**How to read it.** Orange = a human does something. Blue = automation runs. Green = the outcome we're chasing. A full cycle takes somewhere between 10 minutes (Tier A buyer ready to close) and 30 days (slow-moving deal, closing delays). The operator touches it twice: once to mark the deal Actively Marketing, once when the deal closes and the paperwork needs review.

---

## Full Swim-Lane (the whole map)

Four lanes: Notion | n8n | GHL | Buyer. Every node on the happy path expanded out, plus the decision points where things can go sideways.

```mermaid
flowchart TB
    subgraph NOTION["NOTION — Deal Inventory"]
        N1[Brooke drops new deal] --> N2[Fills Asset Class,<br/>Market, Price, Summary URL]
        N2 --> N3[Marks Status:<br/>Actively Marketing]
        N3 --> N4[Blasted checkbox<br/>stays unchecked]
    end

    subgraph N8N["n8n — n8n.dealpros.io"]
        X1[Notion Bridge<br/>polls every 10 min] --> X2{Status = Ready to Blast<br/>AND Blasted = false?}
        X2 -->|yes| X3[POST to Match Engine<br/>webhook]
        X3 --> X4[Pull all buyer:active<br/>contacts from GHL]
        X4 --> X5[Filter on asset class<br/>+ market + price band]
        X5 --> X6{24h cooldown<br/>check per buyer}
        X6 -->|pass| X7[Write deal fields<br/>to matched contacts]
        X7 --> X8[Apply deal:new-inventory<br/>tag · staggered by tier]
        X8 --> X9[Mark Notion deal<br/>Blasted = true]
    end

    subgraph GHL["GHL — Terms For Sale"]
        G1[Tag triggers WF02] --> G2{Buyer Tier?}
        G2 -->|A| G3[Send immediately]
        G2 -->|B| G4[Wait 1h · then send]
        G2 -->|C| G5[Wait 4h · then send]
        G3 --> G6[Update Last Touch Date<br/>and Last Deal Sent Date]
        G4 --> G6
        G5 --> G6
        G6 --> G7[Wait 24h]
        G7 --> G8{Buyer replied<br/>or clicked link?}
        G8 -->|yes| G9[Move to Under Negotiation<br/>task to Eddie: 2h callback]
        G8 -->|no| G10[Remove tag · end]
    end

    subgraph BUYER["BUYER"]
        B1[Receives SMS + email] --> B2{Interested?}
        B2 -->|yes| B3[Replies YES<br/>or clicks link]
        B2 -->|no| B4[No action<br/>next deal next time]
    end

    N4 -.-> X1
    X8 -.-> G1
    G3 -.-> B1
    G4 -.-> B1
    G5 -.-> B1
    B3 -.-> G8

    classDef operator fill:#F7941D,stroke:#0D1F3C,color:#fff,stroke-width:2px
    classDef automated fill:#29ABE2,stroke:#0D1F3C,color:#fff,stroke-width:1px
    classDef decision fill:#FCD34D,stroke:#0D1F3C,color:#0D1F3C,stroke-width:1px
    classDef buyer fill:#A78BFA,stroke:#0D1F3C,color:#fff,stroke-width:2px
    classDef outcome fill:#10B981,stroke:#0D1F3C,color:#fff,stroke-width:2px

    class N1,N2,N3,N4 operator
    class X1,X3,X4,X5,X7,X8,X9,G1,G3,G4,G5,G6,G7,G10 automated
    class X2,X6,G2,G8,B2 decision
    class B1,B3,B4 buyer
    class G9 outcome
```

**How to read it.** Solid arrows are handoffs inside a system. Dotted arrows cross system boundaries — those are the points where things most often break. If you're diagnosing a failure, trace the dotted arrow that corresponds to what the buyer did or didn't receive.

**Color key.**
- **Orange** — Brooke or a team member does this by hand.
- **Blue** — automation does this. Nobody should be clicking anything here.
- **Yellow** — decision point. The system routes based on data already in it.
- **Purple** — buyer-side. Happens on the buyer's phone or in their inbox.
- **Green** — the outcome a good cycle produces (task to Eddie = we have an interested buyer).

**The three break points worth memorizing.**
1. **Notion → n8n.** If Notion isn't showing Blasted=true within ~15 minutes of marking Actively Marketing, the bridge didn't fire. Check n8n.dealpros.io execution log first.
2. **n8n → GHL tag application.** If n8n execution log shows success but no SMS went out, the tag was applied but WF02 didn't trigger. This is the WF02 SMS gap — see Troubleshooting in TEAM_SOP.md.
3. **GHL WF02 → buyer.** If WF02 history shows the step fired but the buyer never got it, it's an LC Phone or Mailgun delivery issue. Check the GHL conversation for the contact.
