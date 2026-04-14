var React = window.React;
function jsx(type, props, key) {
  if (key !== undefined) {
    props = Object.assign({}, props, { key: key });
  }
  return React.createElement(type, props);
}
export { jsx, jsx as jsxs, jsx as jsxDEV };
export var Fragment = React.Fragment;
