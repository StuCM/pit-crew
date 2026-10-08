// The task chat's composer, drawn here because Desktop's Input is fixed-width, framed and adds its own submit chip.
// It owns the typing; the hooks module hears { send } on Enter or a click on ↵, and clears it by bumping props.clear.
export default function Composer(props, s) {
  const { Box, Text } = s.elements;
  if (s.state === undefined) {
    const send = () => {
      if (s.state.text.trim()) s.post({ send: s.state.text });
      s.setState({ ...s.state, text: '' });
    };
    s.onPointer((e) => {
      if (e.type !== 'down') return;
      // the ↵ sits in the last columns of the bottom-right corner
      if (e.x >= s.columns - 4 && e.y >= s.rows - 2) send();
      else s.setState({ ...s.state, isFocused: true });
    });
    s.onKey((e) => {
      const { text } = s.state;
      let next;
      if (e.key === 'return' && !e.shift) return send();
      if (e.key === 'return') next = text + '\n';
      else if (e.key === 'backspace') next = text.slice(0, -1);
      else if (e.key === 'space') next = text + ' ';
      else if ([...e.key].length === 1 && !e.ctrl && !e.meta) next = text + e.key;
      else return;
      s.setState({ ...s.state, text: next, isFocused: true });
    });
    s.setState({ text: '', isFocused: false, clear: props.clear });
  }
  const state = s.state ?? { text: '', isFocused: false, clear: props.clear };
  if (props.clear !== state.clear) s.setState({ ...state, text: '', clear: props.clear });
  const caret = state.isFocused ? '▍' : '';
  return Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: props.border,
    backgroundColor: props.card,
    paddingX: 2,
    paddingY: 1,
    children: [
      state.text
        ? Text({ color: props.ink, children: [state.text + caret] })
        : Text({ color: props.faint, children: [caret + props.placeholder] }),
      Box({
        flexDirection: 'row',
        children: [
          Box({ flexGrow: 1, children: [] }),
          Text({ color: props.faint, children: ['↵'] }),
        ],
      }),
    ],
  });
}
