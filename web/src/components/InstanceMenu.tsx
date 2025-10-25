import React from 'react';

interface Props {
  instances: string[];
  current: string;
  setCurrent: (id: string) => void;
  createInstance: () => void;
}

const InstanceMenu: React.FC<Props> = ({ instances, current, setCurrent, createInstance }) => {
  return (
    <div className="instance-menu">
      {instances.map((id) => (
        <button key={id} onClick={() => setCurrent(id)} style={{ fontWeight: current === id ? 'bold' : 'normal' }}>
          {id.slice(0, 4)}
        </button>
      ))}
      <button onClick={() => createInstance()}>+</button>
    </div>
  );
};

export default InstanceMenu;
