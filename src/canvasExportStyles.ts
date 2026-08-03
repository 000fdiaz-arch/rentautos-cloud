type StyledElement = HTMLElement | SVGElement;

export function inlineComputedStylesForCanvas(root: HTMLElement): () => void {
  const elements: StyledElement[] = [
    root,
    ...Array.from(root.querySelectorAll<StyledElement>("*"))
  ];
  const previousStyles = elements.map((element) => ({
    element,
    style: element.getAttribute("style")
  }));

  elements.forEach((element) => {
    const computed = window.getComputedStyle(element);
    Array.from(computed).forEach((property) => {
      try {
        element.style.setProperty(
          property,
          computed.getPropertyValue(property),
          computed.getPropertyPriority(property)
        );
      } catch {
        // Some browser-computed properties are read-only for SVG nodes.
      }
    });
  });

  return () => {
    previousStyles.forEach(({ element, style }) => {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    });
  };
}
