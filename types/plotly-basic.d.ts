// plotly.js-basic-dist-min ships no types; it is the plotly.js API with only the scatter, bar and pie traces.
declare module "plotly.js-basic-dist-min" {
  import * as Plotly from "plotly.js";
  export = Plotly;
}
