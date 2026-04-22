import axios from "axios";

const res = await axios.get(
  "https://ibnux.github.io/BMKG-importer/cuaca/wilayah.json"
);

const wilayah = res.data;
console.log("FIELDS:", Object.keys(wilayah[0]));
console.log("SAMPLE:", JSON.stringify(wilayah[0], null, 2));

const match = wilayah.filter(w =>
  Object.values(w).some(v =>
    String(v).toLowerCase().includes("kahuripan")
  )
);
console.log("FOUND:", match.length);
if (match[0]) console.log(JSON.stringify(match[0], null, 2));