// Adds `transition()` to d3 selections before any Mermaid diagram renders.
//
// The node tooltip of Mermaid's flowcharts, class diagrams and state diagrams calls `selection.transition()` on every
// mouseout of a node. The method is added by the side effect of importing d3-transition, but `d3` declares
// `"sideEffects": false`, so webpack resolves Mermaid's `import {select} from "d3"` straight to d3-selection and never
// runs d3-transition: leaving a node with the mouse then throws "tooltipElem.transition is not a function". Importing it
// here runs that side effect once, on the same d3-selection instance Mermaid uses (pnpm links one d3-selection@3 for
// both). Remove this module and the dependency once Mermaid imports d3-transition itself.
import "d3-transition";
