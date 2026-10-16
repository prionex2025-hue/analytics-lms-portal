// Probe rule: reports JSX component references that are not defined in scope.
// ESLint's core no-undef rule skips JSX element names, so bugs like the
// "Archive is not defined" runtime crash slip through linting.
export const jsxNoUndef = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const isDefined = (name, node) => {
      let scope = context.sourceCode.getScope(node);
      while (scope) {
        if (scope.variables.some((v) => v.name === name)) return true;
        scope = scope.upper;
      }
      return false;
    };
    const check = (node) => {
      const nameNode = node.name;
      if (!nameNode) return;
      if (nameNode.type === "JSXIdentifier") {
        const id = nameNode.name;
        if (/^[a-z]/.test(id)) return; // intrinsic element (div, span, ...)
        if (!isDefined(id, nameNode)) {
          context.report({ node: nameNode, message: `'${id}' is not defined (JSX component)` });
        }
      } else if (nameNode.type === "JSXMemberExpression") {
        let root = nameNode;
        while (root.object) root = root.object;
        if (root.type === "JSXIdentifier" && !/^[a-z]/.test(root.name) && !isDefined(root.name, root)) {
          context.report({ node: root, message: `'${root.name}' is not defined (JSX component)` });
        }
      }
    };
    return { JSXOpeningElement: check, JSXClosingElement: check };
  },
};
