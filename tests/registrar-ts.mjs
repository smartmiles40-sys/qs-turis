// tests/registrar-ts.mjs — liga o tests/ts-loader.mjs (ver o comentário lá).
import { register } from "node:module";
register("./ts-loader.mjs", import.meta.url);
