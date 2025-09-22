import React, { useState, useEffect } from 'react';
import { exportDatabase, importDatabase, getSetting, updateSetting, exportFullBackup, importFullBackup } from '../services/api';
import {
  Box,
  Button,
  Typography,
  Paper,
  Grid,
  Alert,
  AlertTitle,
  Switch,
  FormControlLabel
} from '@mui/material';
import { MdUploadFile, MdDownload } from 'react-icons/md';

interface FeedbackState {
  type: 'success' | 'info' | 'warning' | 'error' | '';
  message: string;
}

const Admin: React.FC = () => {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importZipFile, setImportZipFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({ type: '', message: '' });
  const [showDipulMapLink, setShowDipulMapLink] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await getSetting('show_dipul_map_link');
        setShowDipulMapLink(response.data.value === 'true');
      } catch (error) {
        console.error("Error fetching settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const handleExport = async () => {
    try {
      const response = await exportDatabase();
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dronelogger_export_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFeedback({ type: 'success', message: 'Database exported successfully!' });
    } catch (error) {
      console.error('Error exporting database:', error);
      setFeedback({ type: 'error', message: 'Error exporting database. Check console for details.' });
    }
  };

  const handleExportZip = async () => {
    try {
      const response = await exportFullBackup();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const contentDisposition = response.headers['content-disposition'];
      let filename = 'dronelogger_backup.zip';
      if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
          if (filenameMatch.length === 2)
              filename = filenameMatch[1];
      }
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setFeedback({ type: 'success', message: 'Full backup exported successfully!' });
    } catch (error) {
      console.error('Error exporting full backup:', error);
      setFeedback({ type: 'error', message: 'Error exporting full backup. Check console for details.' });
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setImportFile(event.target.files[0]);
      setFeedback({ type: '', message: '' });
    }
  };

  const handleZipFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setImportZipFile(event.target.files[0]);
      setFeedback({ type: '', message: '' });
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      setFeedback({ type: 'error', message: 'Please select a JSON file to import.' });
      return;
    }

    if (!window.confirm('WARNING: Importing will OVERWRITE all existing data. This cannot be undone. Are you sure you want to proceed?')) {
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', importFile);
      await importDatabase(formData);
      setFeedback({ type: 'success', message: 'Database imported successfully! Please refresh the page to see the changes.' });
      setImportFile(null);
    } catch (error) {
      console.error('Error importing database:', error);
      setFeedback({ type: 'error', message: 'Error importing database. Check console for details.' });
    }
  };

  const handleImportZip = async () => {
    if (!importZipFile) {
      setFeedback({ type: 'error', message: 'Please select a ZIP file to import.' });
      return;
    }

    if (!window.confirm('WARNING: Importing a full backup will OVERWRITE all existing data, including images. This cannot be undone. Are you sure you want to proceed?')) {
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', importZipFile);
      await importFullBackup(formData);
      setFeedback({ type: 'success', message: 'Full backup imported successfully! Please refresh the page to see the changes.' });
      setImportZipFile(null);
    } catch (error) {
      console.error('Error importing full backup:', error);
      setFeedback({ type: 'error', message: 'Error importing full backup. Check console for details.' });
    }
  };

  const handleDipulLinkChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setShowDipulMapLink(newValue);
    try {
      await updateSetting('show_dipul_map_link', newValue.toString());
      setFeedback({ type: 'success', message: 'Setting updated successfully!' });
    } catch (error) {
      console.error('Error updating setting:', error);
      setFeedback({ type: 'error', message: 'Error updating setting. Check console for details.' });
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Admin Panel</Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Export</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Export all current data from the database to a single JSON file. This is useful for creating backups.
            </Typography>
            <Button variant="contained" startIcon={<MdDownload />} onClick={handleExport} sx={{ mr: 1 }}>
              Export Data Only
            </Button>
            <Button variant="contained" color="primary" startIcon={<MdDownload />} onClick={handleExportZip}>
              Export Full Backup (ZIP)
            </Button>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Import</Typography>
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle>Warning</AlertTitle>
              Importing from a file will <strong>completely overwrite</strong> all existing data in the database.
            </Alert>
            <Typography variant="subtitle1" sx={{ mt: 2 }}>Import Data Only</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <Button component="label" variant="outlined" startIcon={<MdUploadFile />}>
                {importFile ? importFile.name : 'Select JSON File'}
                <input type="file" hidden accept=".json" onChange={handleFileChange} />
              </Button>
              <Button variant="contained" color="error" onClick={handleImport} disabled={!importFile}>
                Import Data
              </Button>
            </Box>
            <Typography variant="subtitle1" sx={{ mt: 2 }}>Import Full Backup</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button component="label" variant="outlined" startIcon={<MdUploadFile />}>
                {importZipFile ? importZipFile.name : 'Select ZIP File'}
                <input type="file" hidden accept=".zip" onChange={handleZipFileChange} />
              </Button>
              <Button variant="contained" color="error" onClick={handleImportZip} disabled={!importZipFile}>
                Import Backup
              </Button>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Display Settings</Typography>
            <FormControlLabel
              control={<Switch checked={showDipulMapLink} onChange={handleDipulLinkChange} />}
              label="Show Dipul Map Link (for Germany)"
            />
          </Paper>
        </Grid>

        {feedback.message && feedback.type && (
          <Grid item xs={12}>
            <Alert severity={feedback.type}>{feedback.message}</Alert>
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

export default Admin;
