import React, { useState } from 'react';
import { useChat } from '../hooks/useChat';
import InstanceMenu from './InstanceMenu';
import FileUpload from './FileUpload';
import { useAccount } from 'wagmi';

interface Props {
  grokKey?: string | null;
}

const Chat: React.FC<Props> = ({ grokKey }) => {
  const { address } = useAccount();
  const { instances, current, setCurrent, createInstance, messages, sendMessage } = useChat(grokKey);
  const [input, setInput] = useState('');
  const [background, setBackground] = useState(false);

  const headers = grokKey ? { 'x-grok-key': grokKey } : address ? { 'x-wallet-address': address } : {};

  const handleSend = async () => {
    if (!input) return;
    await sendMessage(input, background);
    setInput('');
  };

  return (
    <div className="chat-container">
      <InstanceMenu
        instances={instances}
        current={current}
        setCurrent={setCurrent}
        createInstance={createInstance}
      />
      <div className="messages">
        {(messages[current] || []).map((m, i) => (
          <div key={i} className={`message ${m.role}`}>{m.content}</div>
        ))}
      </div>
      <FileUpload instanceId={current} headers={headers} onUploaded={(p) => sendMessage(`Use file ${p}`)} />
      <div className="input-area">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} />
        <label>
          <input type="checkbox" checked={background} onChange={e => setBackground(e.target.checked)} />bg
        </label>
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
};

export default Chat;
