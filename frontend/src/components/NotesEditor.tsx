import { useState } from 'react';

interface NotesEditorProps {
  initialNotes: string;
  onSave: (newNotes: string) => Promise<void>;
}

function NotesEditor({ initialNotes, onSave }: NotesEditorProps) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes);

  const handleSave = async () => {
    await onSave(notes);
    setEditing(false);
  };

  if (editing) {
    return (
      <div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={8}
          style={{ width: '100%' }}
        />
        <button onClick={handleSave}>Save Notes</button>
        <button onClick={() => setEditing(false)}>Cancel</button>
      </div>
    );
  }

  return (
    <div>
      <p>{initialNotes || 'No notes.'}</p>
      <button onClick={() => setEditing(true)}>Edit Notes</button>
    </div>
  );
}

export default NotesEditor;
