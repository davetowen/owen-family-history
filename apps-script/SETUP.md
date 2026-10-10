# Setting up the "Place & Era" helper (about 10 minutes)

This little script lets the family website ask Gemini about a place and year ("Rhinelander, Wisconsin, 1915") without putting your Gemini key on the public website. Answers are saved in a new **Place & Era** tab in the Owen Genealogy sheet, so each place and year is only asked once.

## 1. Get a free Gemini key
1. Go to **aistudio.google.com** and sign in with your Google account.
2. Click **Get API key**, then **Create API key**. Copy it.

Note: on the free tier, Google may use what is sent to improve its products. The script only sends a place name and a year, never anything about a person.

## 2. Add the script to the sheet
1. Open the **Owen Genealogy** sheet.
2. **Extensions → Apps Script**.
3. Delete whatever is in `Code.gs` and paste in the whole of `PlaceEra.gs`.
4. Click the floppy-disk icon to save. Name the project "Owen Place & Era".

## 3. Store the key (not in the code)
1. In the Apps Script editor, click the gear icon (**Project Settings**).
2. Scroll to **Script properties → Add script property**.
3. Property: `GEMINI_API_KEY`  Value: the key you copied. **Save**.
4. Optional: `MAX_NEW_PER_DAY` (default 150), `GEMINI_MODEL` (default `gemini-3.8-flash`).

## 4. Test it once
1. Back in the editor, pick **testOnce** from the function dropdown and click **Run**.
2. Google will ask for permission (to read the sheet and contact Gemini). Approve it. If you see "Google hasn't verified this app", click **Advanced → Go to Owen Place & Era**. It's your own script.
3. The log should show some facts about Rhinelander in 1915, and a **Place & Era** tab appears in the sheet.

## 5. Publish it as a web app
1. **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
4. Send that URL to Claude. It goes into the website, and the "world they were born into" panels switch from built-in history to Gemini.

## Looking after it
- **Fix a fact:** edit the Facts cell in the Place & Era tab. The website shows your version.
- **Get a fresh answer:** type `Redo` in the Reviewed column.
- **Mark as checked:** type anything else in Reviewed, for example `OK – Dave`.
- **Guard rails:** it only answers for towns that appear in the Master Database, and it stops after the daily limit.
- **If you change the code later,** use **Deploy → Manage deployments → Edit → New version**, so the URL stays the same.
