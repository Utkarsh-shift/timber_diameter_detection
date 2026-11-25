# Pine OS – demo script (about 12 minutes)

**One line:** a photo of a truck's log ends goes in; per-log diameters, a grade and a signed report come out, and every company sees only its own data.

Lines marked **Do** are clicks or commands. Lines marked **Say** are what you tell the audience.

---

## Before the demo (10 minutes earlier)

1. Start everything: `npm run dev` in the repo root. Wait until the header badge reads **CV ENGINE ONLINE**.
2. Open two browser windows side by side, both on `http://localhost:5173`:
   - Window 1: sign in as **jkpapers@jkpaper.com** / **jk123$** (JK Paper).
   - Window 2, in a private window so the cookies stay separate: **admin@xyzpaper.com** / **Demo@1234** (XYZ Paper).
3. Warm up the detector so the first live run is not slow. In a terminal:
   ```
   .\demo\analyze.ps1 -Image samples\synthetic_pile.jpg
   .\demo\analyze.ps1 -Dataset val/image18.JPG -Profile timbervision-v1.0-seg
   ```
   Each command signs in, analyses the photo and opens it in the Studio. Close those tabs afterwards. These two runs are your fallback if a live run fails.
4. Have the terminal open and large enough to read. Keep the repo folder as its working directory.

> Be upfront about what is simulated: the 48 pre-loaded trucks and the trucks that appear on their own are **demo data**. The **photo analysis is real**. Say this once, early, and the rest of the demo is easier to trust.

---

## 1. Opening (30 seconds)

**Say:** "When a truck of logs arrives at a mill, someone has to count the logs, estimate their diameter and decide the grade. That is slow and varies from person to person. Pine OS does it from a single photo of the log ends, and keeps a record a person can review and sign off."

---

## 2. Sign-in and separate companies (1 minute)

**Do:** Show the sign-in screen in Window 1, sign in. Point at the header: company name and email top-right.

**Say:** "Each company has its own account. This is JK Paper. Everything on screen belongs to JK Paper."

---

## 3. Overview: the whole operation at a glance (2 minutes)

**Do:** Go to **Overview** in Window 1.

**Say, pointing as you go:**
- "The big chart is the **log diameter distribution** across all deliveries. The dashed lines mark the average, the median and the 90th percentile. Red bars are undersized logs."
- "On the right: trucks by status, and how many are flagged for review."
- "Below: logs detected, trucks waiting in the queue, and how long an analysis takes."

**Do:** Click the calendar button, choose **Today**, then **Last 7 days**, then pick a custom range by clicking two dates.

**Say:** "Every number follows the date range, so a manager can look at a shift, a day or a week."

**Do:** Scroll to **Recent Arrivals**.

---

## 4. The live demo: analyse a photo (3 minutes)

This is the centrepiece. Slow down here.

**Say:** "Now a real analysis. I'll send a photo of a log pile from a truck."

**Do:** In the terminal, run:
```
.\demo\analyze.ps1 -Image samples\synthetic_pile.jpg
```
It prints the truck id, the number of logs (about 161), the mean diameter, the grade and the time taken (about 2 s), then opens the **Measurement Studio**. The pile comes out as **C?** (needs review) because 12 of its logs show heart rot; the test pile contains rotten logs on purpose. It makes a good story: the system flags the truck for a person instead of accepting it.

**Say:** "A couple of seconds later we have the logs found, the mean diameter and an overall grade."

**Do, in the Studio:**
1. Point at the ellipses drawn on the photo. "Each ring is one log end the system found."
2. Click a log. "The right panel shows its diameter, ovality, bark and confidence."
3. Use a correction: nudge or resize, or mark one as a false positive. "A person can correct the machine. Every change is recorded in the audit trail with a reason."
4. Click **Add Missed**, then click the photo where a log was missed. "If it misses one, you click it and it measures that log."
5. Open the log table and the histogram tabs.

**Say:** "The system proposes, the human decides."

**Do:** Click **Approve & Commit**. It opens the **Report**.

**Say:** "That produces the report for this delivery: transport details, timber summary, diameter histogram. It prints, saves as PDF and exports to CSV."

---

## 5. A real, messy photo, scored against the truth (2 minutes)

**Say:** "That was a clean test pile. Real piles are messy: bark, shadows, mud. Here is a real photo from a public research dataset where people marked every log by hand, so we can score the system honestly."

**Do:** In the terminal:
```
.\demo\analyze.ps1 -Dataset val/image18.JPG -Profile timbervision-v1.0-seg
```

**Do, in the Studio:** Toggle **GT boxes**. Show the score card.

**Say:** "The boxes are the human labels. The card shows how many of the logs the people marked we found, and how many extra circles we drew that they did not. On this photo we find about 94 out of 100 logs, but we also draw a lot of extra circles, so precision is only about 24 percent. Across the whole dataset the best detector finds about 89 percent of logs with about 56 percent precision. A reviewer removes the extra circles in a few clicks. The simple OpenCV detector does far worse on photos like this. We tested several and we are open about that."

> Numbers for this exact photo (checked): 136 logs found, precision 24.3 %, recall 94.3 %, F1 38.6 %, about 15 s. Use these if the card is on screen, and the dataset-wide figures (recall 89 %, precision 56 %) only when you say "across the dataset".

**Say, honestly:** "On a clean pile the system is near-perfect. On messy real photos, it needs a person checking. That is why the review step exists."

---

## 6. Quality and grading (1 minute)

**Do:** Go to **Quality Assessment**.

**Say:**
- "Grade distribution, with the worst log's end shown up close."
- "Trucks needing a decision wait here. An inspector picks a disposition and signs off."
- "The thresholds that decide a grade are editable." Click **Edit Thresholds**, show the fields, cancel. "Each company sets its own."

---

## 7. History and export (1 minute)

**Do:** Go to **Measurement History**. Choose a date range. Click a truck.

**Say:** "Every past delivery is kept. Click one and you get every log with its measurements."

**Do:** Click **Export Excel**, open the file. Then **Export CSV**.

**Say:** "Ready for a spreadsheet or another system."

---

## 8. Proving the companies are separate (1 minute)

**Do:** In Window 1 (JK Paper), copy a truck id from the History list, for example `TRK-10790`. In Window 2 (XYZ Paper), open `http://localhost:5173/studio?truck=` followed by that id.

**Say:** "I'm signed in as XYZ Paper and asking for a JK Paper truck by its exact id."

**Do:** The page shows **Truck not found**.

**Say:** "The check is on the server, not just the screen. The same applies to photos, reports and exports."

---

## 9. Models page and close (30 seconds)

**Do:** Open **AI Model Monitoring**.

**Say:** "Which detector is active, how long analyses take, and how much of the machine's memory the services use."

**Close, Say:** "To recap: one photo gives you counts, diameters and a grade. A person reviews and signs off. Every company's data is kept separate. Today it runs on a laptop; the next step is training on your own camera's photos, which is where the accuracy improves most."

---

## Questions you will probably get

| Question | Honest answer |
|---|---|
| How accurate are the diameters? | On clean synthetic piles the average error is about 1.6 mm. On real photos we have **not** been able to verify diameters in millimetres, because the public dataset only has log positions, not measured sizes. We would validate this on your own measured loads. |
| Where does the scale in millimetres come from? | Today it is **assumed**: the pile is taken to be 2.4 m wide, or you give a millimetre-per-pixel value. With a fixed camera at a known distance it would be calibrated once, and then it is a measurement. |
| Does it find every log? | The best detector finds about 89 percent on real messy photos. Some of what it draws is wrong, which is why a person reviews. |
| Can it measure cracks and rot? | Only on high-resolution photos. On small photos it says "not measurable" instead of guessing. |
| Can we use it commercially? | The best detector was trained on data and with software under non-commercial and AGPL licences. For a product we would retrain on your own photos with permissive tools. |
| Is the data real? | The pre-loaded trucks and the arrivals that appear by themselves are **simulated** for the demo. The photo analysis is real. |
| Is it secure? | Accounts, separate company data and server-side checks are in. It runs over plain http on one machine, so it needs https and a proper user setup before going on a network. |
| How do we add a user? | `npm run adduser -w backend -- <email> "<name>" <company id> <password>`. There is no self sign-up on purpose. |

---

## If something goes wrong

| Problem | What to do |
|---|---|
| Header says **CV ENGINE OFFLINE** | The analysis service is not up. Wait about 20 seconds, or restart with `npm run dev`. Use the two warm-up trucks from before the demo as your live examples. |
| The terminal command fails | Show the warm-up trucks in **Truck Intake & Queue** instead; they are the newest rows. |
| The TimberVision run is slow | It takes about 15 seconds on this laptop. Keep talking about the ground-truth boxes. If it fails, drop `-Profile timbervision-v1.0-seg` to use the default detector. |
| Signed out suddenly | Sign in again. Sessions end when the server restarts or after 7 days. |
| A page looks empty | Check the date range button. Set it to **All time**. |
