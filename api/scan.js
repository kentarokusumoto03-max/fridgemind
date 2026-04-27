// /api/scan.js — Vercel Serverless Function
// Receives a base64 image + scan type, calls Claude Vision API, returns structured food items

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { image, scanType } = req.body;
  if (!image || !scanType) return res.status(400).json({ error: "Missing image or scanType" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  // Build prompt based on scan type
  const prompts = {
    label: `You are a nutrition label reader for a fridge inventory app. Analyze this photo of a food product (nutrition label and/or front packaging).

Extract and return a JSON object with this exact structure:
{
  "items": [
    {
      "name": "Product name in English",
      "name_ja": "Product name in Japanese (translate if needed)",
      "category": "one of: protein, dairy, produce, grains, condiments, frozen, beverages, other",
      "qty": number (total quantity in the package),
      "unit": "g" or "ml" or "pcs",
      "calories": number (per 100g/ml),
      "protein": number (per 100g/ml),
      "carbs": number (per 100g/ml),
      "fat": number (per 100g/ml),
      "expiresIn": number (estimated days until expiry, use 7 if unclear)
    }
  ]
}

If you can read Japanese text on the label, use it. Return ONLY the JSON, no other text.`,

    receipt: `You are a receipt reader for a fridge inventory app. Analyze this grocery receipt photo.

Extract every food item you can identify and return a JSON object:
{
  "items": [
    {
      "name": "Product name in English",
      "name_ja": "Product name in Japanese (if visible on receipt)",
      "category": "one of: protein, dairy, produce, grains, condiments, frozen, beverages, other",
      "qty": number (estimated typical quantity — e.g. 500 for 500g of chicken, 1000 for 1L milk),
      "unit": "g" or "ml" or "pcs",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "expiresIn": number (estimated days — fresh produce 5, dairy 7, meat 3, pantry items 90, etc.)
    }
  ]
}

For abbreviated item names on receipts, interpret them as best you can (e.g. "ORG BNLS CHKN" = Organic Boneless Chicken).
If the receipt is in Japanese, translate item names to English in the "name" field and keep Japanese in "name_ja".
Return ONLY the JSON, no other text.`,

    fridge: `You are a fridge content analyzer for a food inventory app. Look at this photo of the inside of a fridge.

Identify every food item you can see and return a JSON object:
{
  "items": [
    {
      "name": "Item name in English",
      "name_ja": "Item name in Japanese",
      "category": "one of: protein, dairy, produce, grains, condiments, frozen, beverages, other",
      "qty": number (rough estimate of quantity in g, ml, or pieces),
      "unit": "g" or "ml" or "pcs",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "expiresIn": number (estimate based on item type)
    }
  ]
}

Be thorough — identify containers, bottles, bags, produce, condiments, everything visible.
Return ONLY the JSON, no other text.`,

    barcode_fallback: `You are analyzing a photo of a product for a fridge inventory app. The user tried to scan a barcode but we're using the photo instead.

Identify the product from the packaging visible in the photo and return:
{
  "items": [
    {
      "name": "Product name in English",
      "name_ja": "Product name in Japanese",
      "category": "one of: protein, dairy, produce, grains, condiments, frozen, beverages, other",
      "qty": number (package size),
      "unit": "g" or "ml" or "pcs",
      "calories": number (if visible, else 0),
      "protein": number (if visible, else 0),
      "carbs": number (if visible, else 0),
      "fat": number (if visible, else 0),
      "expiresIn": number (estimated days)
    }
  ]
}

Return ONLY the JSON, no other text.`
  };

  const systemPrompt = prompts[scanType] || prompts.label;

  // Determine media type from base64 header
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
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: systemPrompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return res.status(500).json({ error: "Claude API error", details: errText });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    // Parse JSON from response (strip markdown fences if present)
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("JSON parse error:", cleaned);
      return res.status(500).json({ error: "Failed to parse AI response", raw: cleaned });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
}
