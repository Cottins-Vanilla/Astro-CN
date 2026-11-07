/**
 * Default footprint for a `CanvasNode` of type "note" — the `.scanvas`
 * format still requires width/height per docs/DATA-FORMAT.md even though
 * there's no 2D canvas UI to size a chip for anymore. Canvases now exist
 * purely as the structural-edge store behind the 3D graph (see
 * docs/WORKSPACE-3D.md); these are just placeholder dimensions.
 */
export const NOTE_NODE_WIDTH = 200;
export const NOTE_NODE_HEIGHT = 44;
