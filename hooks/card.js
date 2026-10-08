// A transparent click layer over a board row, since an Svg takes no presses. It posts { select: id }.
export default function Card(props, s) {
  const { Box } = s.elements;
  if (s.state === undefined) {
    s.onPointer((e) => {
      if (e.type === 'down') s.post({ select: props.id });
    });
    s.setState({});
  }
  return Box({ key: 'hit', width: Math.max(s.columns, 1), height: Math.max(s.rows, 1) });
}
