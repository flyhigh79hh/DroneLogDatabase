import { useState, useEffect, useMemo } from 'react';
import { getPilots, createPilot, setAsDefaultPilot, deletePilot } from '../services/api';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  TableSortLabel,
  Chip
} from '@mui/material';
import { MdDelete, MdStar } from 'react-icons/md';

// Interfaces & Types
interface Pilot { id: number; name: string; is_default: boolean; }
type Order = 'asc' | 'desc';

// Sorting Functions
function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
  if (b[orderBy] < a[orderBy]) return -1;
  if (b[orderBy] > a[orderBy]) return 1;
  return 0;
}

function getComparator<T, Key extends keyof T>(
  order: Order,
  orderBy: Key,
): (a: T, b: T) => number {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}

function stableSort<T>(array: readonly T[], comparator: (a: T, b: T) => number) {
  const stabilizedThis = array.map((el, index) => [el, index] as [T, number]);
  stabilizedThis.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    if (order !== 0) return order;
    return a[1] - b[1];
  });
  return stabilizedThis.map((el) => el[0]);
}

function Pilots() {
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [newPilotName, setNewPilotName] = useState('');
  const [order, setOrder] = useState<Order>('asc');
  const [orderBy, setOrderBy] = useState<keyof Pilot>('name');

  useEffect(() => { fetchPilots(); }, []);

  const fetchPilots = async () => {
    const response = await getPilots();
    setPilots(response.data);
  };

  const handleRequestSort = (property: keyof Pilot) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedPilots = useMemo(() => 
    stableSort(pilots, getComparator(order, orderBy)), 
    [pilots, order, orderBy]
  );

  const handleCreatePilot = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPilotName.trim() === '') return;
    await createPilot(newPilotName);
    setNewPilotName('');
    fetchPilots();
  };

  const handleSetDefault = async (pilotId: number) => {
    await setAsDefaultPilot(pilotId);
    fetchPilots();
  };

  const handleDeletePilot = async (pilotId: number) => {
    if (window.confirm('Are you sure you want to delete this pilot?')) {
      await deletePilot(pilotId);
      fetchPilots();
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
      <Paper sx={{ p: 2, flex: 1 }}>
        <Typography variant="h5" component="h2" gutterBottom>Add New Pilot</Typography>
        <Box component="form" onSubmit={handleCreatePilot} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField label="Pilot Name" variant="outlined" value={newPilotName} onChange={(e) => setNewPilotName(e.target.value)} required />
          <Button type="submit" variant="contained" sx={{ alignSelf: 'flex-start' }}>Add Pilot</Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2, flex: 2 }}>
        <Typography variant="h5" component="h2" gutterBottom>Existing Pilots</Typography>
        <TableContainer>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sortDirection={orderBy === 'name' ? order : false}>
                  <TableSortLabel active={orderBy === 'name'} direction={orderBy === 'name' ? order : 'asc'} onClick={() => handleRequestSort('name')}>Name</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={orderBy === 'is_default' ? order : false}>
                  <TableSortLabel active={orderBy === 'is_default'} direction={orderBy === 'is_default' ? order : 'asc'} onClick={() => handleRequestSort('is_default')}>Default</TableSortLabel>
                </TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedPilots.map((pilot) => (
                <TableRow key={pilot.id} hover>
                  <TableCell>{pilot.name}</TableCell>
                  <TableCell>{pilot.is_default && <Chip label="Default" color="primary" size="small" />}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Set as Default">
                      <span><IconButton onClick={() => handleSetDefault(pilot.id)} disabled={pilot.is_default} size="small"><MdStar /></IconButton></span>
                    </Tooltip>
                    <Tooltip title="Delete"><IconButton onClick={() => handleDeletePilot(pilot.id)} size="small"><MdDelete /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}

export default Pilots;