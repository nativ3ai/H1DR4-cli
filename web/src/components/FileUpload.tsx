import React from 'react';
import axios from 'axios';

interface Props {
  instanceId: string;
  headers: Record<string, string>;
  onUploaded: (path: string) => void;
}

const FileUpload: React.FC<Props> = ({ instanceId, headers, onUploaded }) => {
  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const res = await axios.post('/upload', form, {
      headers: { ...headers, 'x-instance-id': instanceId },
    });
    onUploaded(res.data.path);
  };

  return <input type="file" onChange={handleChange} />;
};

export default FileUpload;
