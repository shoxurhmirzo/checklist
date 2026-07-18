import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadCaveat } from "@remotion/google-fonts/Caveat";

const inter = loadInter("normal", { weights: ["400", "500", "600", "700", "800"] });
const caveat = loadCaveat("normal", { weights: ["600", "700"] });

export const fonts = {
  ui: inter.fontFamily,
  hand: caveat.fontFamily,
};

export const colors = {
  paper: "#f7f4ee",
  paperDeep: "#efeadf",
  ink: "#1b1b1f",
  inkSoft: "#5c5a54",
  line: "#d8d2c4",
  card: "#fffdf8",
  green: "#2f9e44",
  greenSoft: "#e6f4ea",
  red: "#e03131",
  amber: "#e8930c",
  blue: "#3b5bdb",
};
