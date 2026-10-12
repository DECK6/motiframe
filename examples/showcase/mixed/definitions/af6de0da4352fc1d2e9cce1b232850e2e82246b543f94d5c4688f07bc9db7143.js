var MotiFrameElement = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // source:index.ts
  var index_exports = {};
  __export(index_exports, {
    default: () => index_default
  });

  // vendor:@motiframe/authoring
  var s = window.MotiFrameSDK;
  var defineReactElement = s.defineReactElement;
  var defineHtmlElement = s.defineHtmlElement;
  var MotionTarget = s.MotionTarget;
  var MotionSlot = s.MotionSlot;
  var ThreeCanvas = s.ThreeCanvas;

  // source:index.ts
  var index_default = defineHtmlElement({ "id": "showcase-field", "revision": 1, "kind": "html", "moduleHash": "", "propsSchema": { "type": "object" }, "targets": [{ "key": "root", "channels": ["x", "y", "z", "scaleX", "scaleY", "rotateX", "rotateY", "rotateZ", "opacity", "clipProgress"], "coordinateSpace": "local" }], "slots": [], "assets": [] }, { "html": '<div class="form"></div>', "css": ".form{background-image:radial-gradient(circle at 80% 30%,rgba(170,220,190,.1),transparent 48%),repeating-linear-gradient(90deg,transparent,transparent 79px,rgba(170,220,190,.055) 80px),repeating-linear-gradient(0deg,transparent,transparent 59px,rgba(170,220,190,.055) 60px)}", "bindings": [{ "selector": ".form", "prop": "width", "kind": "style", "name": "width", "unit": "px" }, { "selector": ".form", "prop": "height", "kind": "style", "name": "height", "unit": "px" }, { "selector": ".form", "prop": "fill", "kind": "style", "name": "background-color" }, { "selector": ".form", "prop": "color", "kind": "style", "name": "color" }] });
  return __toCommonJS(index_exports);
})();

window.motiframe.registerDefinition("showcase-field@1",MotiFrameElement.default);