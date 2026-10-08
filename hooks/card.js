// One board card, drawn here so a click anywhere on it selects the task (a Button takes no children,
// and Desktop draws only the first line of a multi-line label). It posts { select: id }.
export default function Card(props, s) {
  const { Box, Text } = s.elements;
  if (s.state === undefined) {
    s.onPointer((e) => {
      if (e.type === 'down') s.post({ select: props.id });
    });
    s.setState({});
  }
  const c = props.colors;
  const border = props.isSelected ? c.clay : props.attention ? c.amb : c.cardBorder;
  return Box({
    key: 'card',
    width: Math.max(s.columns, 1),
    flexDirection: 'column',
    rowGap: 1,
    borderStyle: 'round',
    borderColor: border,
    backgroundColor: c.card,
    paddingX: 2,
    paddingY: 1,
    hover: { borderColor: props.isSelected ? c.clay : c.border },
    children: [
      Text({ bold: true, color: c.ink, children: [props.title] }),
      Text({ color: c.mut, children: [props.id + ' · ' + props.who] }),
      ...(props.attention
        ? [
            Text({
              color: c.amb,
              backgroundColor: c.ambBg,
              children: [' ⚑ ' + props.attention + ' '],
            }),
          ]
        : []),
      ...(props.tags.length
        ? [
            Box({
              flexDirection: 'row',
              columnGap: 1,
              children: props.tags.map((t) =>
                Text({ color: c.vio, backgroundColor: c.vioBg, children: [' ' + t + ' '] }),
              ),
            }),
          ]
        : []),
    ],
  });
}
