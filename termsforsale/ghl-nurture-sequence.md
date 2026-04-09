# GHL Nurture Sequence — Cowork QR VIP Buyer

> **Trigger:** Tag added = `Source: Cowork QR Buyer`
> **Pipeline:** Move to "Buyer — New" stage
> **Duration:** 7 days
> **Goal:** Get them to reply, click a deal, or book an intake call

---

## Instant (within 1 minute of signup)

### SMS #1 — Personal opener
```
Hey {{contact.first_name}}, it's Brooke from Deal Pros. Saw you joined our VIP list from the office QR. What's 1 type of deal you'd buy tomorrow if the numbers worked?
```

### Email #1 — Welcome + live deals
**Subject:** You're on the VIP list — here are this week's deals
**From:** Brooke @ Terms For Sale

```
Hey {{contact.first_name}},

Welcome to the VIP buyer list. You're now ahead of the public blasts.

Here's what we've got live right now:

→ [View Active Deals](https://termsforsale.com)

Every deal on our board is pre-vetted — we don't blast junk. When something matches your buy box, you'll hear from us first.

Quick reply: what market and deal type are you most focused on right now?

— Brooke
Deal Pros LLC | Terms For Sale
```

---

## Day 1 (next morning, 9:00 AM local)

### SMS #2 — Specific deal push
```
{{contact.first_name}} — just dropped a new deal that might fit your box. Check it out: [DEAL LINK]. Reply INTERESTED if you want the full package or PASS to skip.
```

> **Note:** Swap [DEAL LINK] with the top active deal URL each week, or use a GHL custom value that auto-populates from the latest deal alert.

---

## Day 2 (afternoon, 2:00 PM)

### Email #2 — How we work
**Subject:** How our deal flow works (so you know what to expect)

```
{{contact.first_name}},

Quick breakdown of how we operate:

1. We source off-market deals — wholesale assignments, subject-to, seller finance, wraps, and more.
2. Every deal gets underwritten before it hits our list.
3. VIP buyers (you) see deals before they go to Facebook groups or public blasts.
4. You tell us INTERESTED or PASS. No pressure, no games.

We're not a marketplace. We're operators who move our own contracts. You're buying direct from us or our JV partners.

Current live deals → [View Board](https://termsforsale.com)

— Brooke
```

---

## Day 3 (morning, 10:00 AM)

### SMS #3 — Social proof + nudge
```
{{contact.first_name}}, quick question — are you actively buying right now or building your pipeline for later? Either way we'll match the deal flow to where you're at. Just reply ACTIVE or BUILDING.
```

> **Why:** Segments engaged buyers from tire-kickers. Tag responses: `buyer-active` or `buyer-building`.

---

## Day 5 (morning, 9:30 AM)

### Email #3 — Proof + credibility
**Subject:** Why buyers keep coming back to us

```
{{contact.first_name}},

A few things that make our deals different:

— We underwrite every deal before listing (ARV, comps, rent projections, entry fee breakdown)
— We handle creative structures in-house (subto, seller finance, Morby, wraps)
— We've moved deals in AZ, TX, FL, KY, TN, GA and growing
— No upfront fees. You only pay if you close.

If you want us actively hunting for deals in your buy box, book a quick 10-min call and we'll lock in your criteria:

→ [Book Buyer Intake Call](https://api.leadconnectorhq.com/widget/booking/buyer-intake-call)

— Brooke
```

---

## Day 7 (morning, 10:00 AM)

### SMS #4 — Final push to book
```
{{contact.first_name}} — last nudge. If you want us matching deals specifically to your criteria, grab a 10-min intake call this week: [BOOKING LINK]. After that we'll only send you deals that actually fit. No spam.
```

### Email #4 — Recap + clear CTA
**Subject:** Want us hunting deals for you?

```
{{contact.first_name}},

You've been on the VIP list for a week. Here's where we stand:

✓ You're getting priority deal alerts
✓ Your buy box is on file

Want to take it a step further? Book a 10-minute buyer intake call and we'll:
- Lock in your exact criteria (markets, price, structure, timeline)
- Flag you as a priority match for incoming deals
- Send you a warm intro when something hits

→ [Book Your 10-Min Call](https://api.leadconnectorhq.com/widget/booking/buyer-intake-call)

Talk soon,
Brooke
Deal Pros LLC | Terms For Sale
```

---

## After Day 7

Move contact to **"Buyer — Nurture"** pipeline stage. They continue receiving standard deal alert emails when new deals match their buy box (handled by the existing `notify-buyers` function).

---

## GHL Workflow Setup Checklist

- [ ] Create workflow: **"Cowork QR VIP Buyer Nurture"**
- [ ] Trigger: Tag added → `Source: Cowork QR Buyer`
- [ ] Action 1: Add to pipeline "Buyer Intake" → stage "New"
- [ ] Action 2: Wait 1 minute → Send SMS #1
- [ ] Action 3: Send Email #1 (no wait)
- [ ] Action 4: Wait until next day 9:00 AM → Send SMS #2
- [ ] Action 5: Wait until Day 2 2:00 PM → Send Email #2
- [ ] Action 6: Wait until Day 3 10:00 AM → Send SMS #3
- [ ] Action 7: Wait until Day 5 9:30 AM → Send Email #3
- [ ] Action 8: Wait until Day 7 10:00 AM → Send SMS #4 + Email #4
- [ ] Action 9: Move to pipeline stage "Nurture"
- [ ] Goal event (exits workflow early): Contact replies OR books intake call
