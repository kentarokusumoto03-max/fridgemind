export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { image, scanType } = req.body;
  if (!image || !scanType) return res.status(400).json({ error: "Missing image or scanType" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const prompts = {
    label: `You are analyzing a photo of a food product for a kitchen inventory app. The photo shows the product packaging, nutrition label, or both.

CRITICAL RULES FOR THE PRODUCT NAME:
- Use the EXACT product name as printed on the packaging. Do NOT rename, shorten, or generalize it.
- If the package says "明治おいしい牛乳", the name is "明治おいしい牛乳", NOT "Milk".
- If the package says "Kirkland Organic Free Range Eggs", that is the name, NOT "Eggs".
- Include the brand name AND product name together exactly as printed.
- If the packaging is in Japanese, Korean, Chinese, or any non-English language, the "name" field MUST be the ORIGINAL text exactly as printed on the package.
- The "name_en" field is your best English translation.

Read the nutrition facts table carefully. Different countries use different formats:
- Japan: per 100g or per serving (1食あたり / 100gあたり / 100mlあたり)
- USA: per serving with servings per container
- Korea: per 100g or per serving (1회 제공량)
- Europe: per 100g/100ml
Always normalize to per 100g or 100ml values in your output.

Look for total package weight/volume printed on the package for the qty field.
Look for expiry date (賞味期限, 消費期限, best before, exp) on the label.

Return ONLY this JSON:
{
  "items": [
    {
      "name": "EXACT product name as printed on package in original language",
      "name_en": "English translation of product name",
      "category": "protein|dairy|produce|grains|condiments|frozen|beverages|other",
      "qty": total package quantity as number,
      "unit": "g|ml|pcs",
      "calories": per 100g/ml as number (0 if not visible),
      "protein": per 100g/ml as number (0 if not visible),
      "carbs": per 100g/ml as number (0 if not visible),
      "fat": per 100g/ml as number (0 if not visible),
      "expiresIn": days until expiry as number
    }
  ]
}

Return ONLY valid JSON. No extra text.`,

    receipt: `You are reading a grocery store receipt for a kitchen inventory app.

The receipt could be in ANY language. You MUST handle: Japanese (日本語), English, Korean (한국어), Chinese (中文), Spanish, French, and others.

YOUR JOB: Find and extract every food/grocery item from this receipt.

READING THE RECEIPT:
1. Read EVERY printed line carefully. Receipts are often blurry or use thermal print — look closely.
2. Store-specific abbreviations are common. Interpret them:
   - Japanese stores (イオン, セブン, ローソン, マルエツ, etc.): items often printed as full Japanese product names
   - 牛乳=milk, 卵=eggs, 豚バラ=pork belly, 鶏もも=chicken thigh, 鶏むね=chicken breast
   - 豆腐=tofu, 納豆=natto, 食パン=white bread, お米=rice, キャベツ=cabbage
   - English stores: BNLS=boneless, CHKN=chicken, ORG=organic, GRN=green, WHL=whole, BF=beef, PK=pork
   - Korean stores: 우유=milk, 계란=eggs, 돼지고기=pork, 닭고기=chicken
3. Items on receipts often have prices next to them — the text before the price is usually the item name.
4. SKIP these: store name, address, phone, date, time, subtotal, tax, total, payment method, change, points, barcodes, receipt number, cashier name.
5. If quantity markers exist (x2, ×3, 2点), account for them.

NAME RULES:
- "name" = EXACT text as printed on receipt in the original language. Copy it character by character.
- "name_en" = Your best English interpretation of what this product actually is.
- Example: receipt says "ﾒｲｼﾞｵｲｼｲ牛乳 900ml" → name: "ﾒｲｼﾞｵｲｼｲ牛乳 900ml", name_en: "Meiji Oishii Milk 900ml"
- Example: receipt says "ORG BNLS CHKN BRST" → name: "ORG BNLS CHKN BRST", name_en: "Organic Boneless Chicken Breast"

QUANTITY ESTIMATES (when not printed on receipt):
- Milk/juice/drinks: 1000 ml
- Eggs: 10 pcs
- Rice bag: 5000 g
- Fresh meat/fish: 300 g
- Fresh vegetables: 200 g
- Bread/loaf: 1 pcs
- Tofu: 350 g
- Yogurt: 400 g
- Canned food: 300 g
- Snacks/chips: 150 g
- Frozen items: 300 g

Return ONLY this JSON:
{
  "items": [
    {
      "name": "EXACT text from receipt in original language",
      "name_en": "English translation/interpretation",
      "category": "protein|dairy|produce|grains|condiments|frozen|beverages|other",
      "qty": estimated quantity as number,
      "unit": "g|ml|pcs",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "expiresIn": estimated days (produce=5, dairy=7, meat=3, bread=5, pantry=90, frozen=60, canned=365)
    }
  ]
}

Return ONLY valid JSON. No extra text.`,

    fridge: `You are analyzing a photo of the inside of a refrigerator for a kitchen inventory app.

Look at EVERY shelf, door pocket, drawer, and container visible in the photo.

RULES:
1. List every distinct food item you can identify.
2. If you can read a brand name or product label, use the EXACT text as printed (any language).
3. If you can only see a general item (green vegetables, a bottle), describe it as specifically as you can.
4. "name" field: use whatever language is on the product label. If no label visible, use English.
5. "name_en" field: always English description.
6. Estimate quantities from visual size (half bottle ≈ 500ml, small container ≈ 200g, etc.)
7. Combine identical items (3 apples = 1 entry, qty: 3, unit: pcs)

Return ONLY this JSON:
{
  "items": [
    {
      "name": "Product name (original language from label, or English if no label)",
      "name_en": "English description",
      "category": "protein|dairy|produce|grains|condiments|frozen|beverages|other",
      "qty": estimated number,
      "unit": "g|ml|pcs",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "expiresIn": estimated days remaining
    }
  ]
}

Return ONLY valid JSON. No extra text.`
  };

  const systemPrompt = prompts[scanType] || prompts.label;

  let mediaType = "image/jpeg";
  let base64Data = image;
  if (image.startsWith("data:")) {
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      mediaType = match[1];
      base64Data = match[2];
    }
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64Data },
              },
              { type: "text", text: systemPrompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: "AI scan failed. Please try again.", details: errText });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch (e) {
          return res.status(500).json({ error: "Couldn't read the image clearly. Try better lighting or a different angle." });
        }
      } else {
        return res.status(500).json({ error: "Couldn't read the image clearly. Try better lighting or a different angle." });
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: "Connection error. Check your internet and try again." });
  }
}
