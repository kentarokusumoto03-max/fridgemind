// /api/barcode.js — Vercel Serverless Function
// Looks up a barcode number in Open Food Facts database

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { barcode } = req.body;
  if (!barcode) return res.status(400).json({ error: "Missing barcode" });

  try {
    // Open Food Facts is free, no API key needed, covers millions of products worldwide including Japan
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
      { headers: { "User-Agent": "FridgeMind/1.0 (contact@connecteris.com)" } }
    );

    const data = await response.json();

    if (data.status !== 1 || !data.product) {
      return res.status(404).json({ error: "Product not found", barcode });
    }

    const p = data.product;
    const n = p.nutriments || {};

    // Determine category
    let category = "other";
    const cats = (p.categories_tags || []).join(",").toLowerCase();
    if (cats.includes("meat") || cats.includes("fish") || cats.includes("poultry") || cats.includes("seafood") || cats.includes("egg")) category = "protein";
    else if (cats.includes("dairy") || cats.includes("milk") || cats.includes("cheese") || cats.includes("yogurt")) category = "dairy";
    else if (cats.includes("vegetable") || cats.includes("fruit") || cats.includes("produce") || cats.includes("salad")) category = "produce";
    else if (cats.includes("grain") || cats.includes("bread") || cats.includes("pasta") || cats.includes("rice") || cats.includes("cereal")) category = "grains";
    else if (cats.includes("sauce") || cats.includes("condiment") || cats.includes("spice") || cats.includes("oil") || cats.includes("vinegar")) category = "condiments";
    else if (cats.includes("frozen")) category = "frozen";
    else if (cats.includes("beverage") || cats.includes("drink") || cats.includes("juice") || cats.includes("water") || cats.includes("soda")) category = "beverages";

    // Determine unit and quantity
    let qty = parseFloat(p.product_quantity) || parseFloat(p.quantity?.replace(/[^\d.]/g, "")) || 100;
    let unit = "g";
    const qStr = (p.quantity || "").toLowerCase();
    if (qStr.includes("ml") || qStr.includes("l") || qStr.includes("fl")) unit = "ml";
    if (qStr.includes("l") && !qStr.includes("ml")) qty = qty * 1000; // convert L to ml

    const item = {
      name: p.product_name_en || p.product_name || p.generic_name_en || p.generic_name || "Unknown Product",
      name_ja: p.product_name_ja || p.product_name || "",
      category,
      qty: Math.round(qty),
      unit,
      calories: Math.round(n["energy-kcal_100g"] || n["energy-kcal"] || 0),
      protein: Math.round((n.proteins_100g || 0) * 10) / 10,
      carbs: Math.round((n.carbohydrates_100g || 0) * 10) / 10,
      fat: Math.round((n.fat_100g || 0) * 10) / 10,
      expiresIn: category === "produce" ? 5 : category === "dairy" ? 7 : category === "protein" ? 3 : 30,
      image: p.image_front_small_url || null,
      brand: p.brands || "",
    };

    return res.status(200).json({ items: [item] });
  } catch (err) {
    console.error("Barcode lookup error:", err);
    return res.status(500).json({ error: "Lookup failed", message: err.message });
  }
}
