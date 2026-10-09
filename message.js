const field = document.getElementById('message');
const error = document.getElementById('error');
const count = document.getElementById('count');
const updateCount = () => { count.textContent = `${field.value.length} / 500`; };
field.addEventListener('input', () => { error.textContent = ''; updateCount(); });
document.getElementById('cancel').addEventListener('click', () => window.messageEditor.close());
document.getElementById('random').addEventListener('click', () => { field.value = ''; updateCount(); field.focus(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.messageEditor.close();
});
document.getElementById('form').addEventListener('submit', async event => {
  event.preventDefault();
  const save = document.getElementById('save');
  save.disabled = true;
  try {
    const result = await window.messageEditor.save(field.value);
    if (!result.ok) error.textContent = result.error;
  } catch { error.textContent = 'Could not save the message. Please try again.'; }
  finally { save.disabled = false; }
});
window.messageEditor.load().then(value => {
  field.value = value;
  updateCount();
  field.focus();
  field.select();
}).catch(() => { error.textContent = 'Could not load your message.'; });
