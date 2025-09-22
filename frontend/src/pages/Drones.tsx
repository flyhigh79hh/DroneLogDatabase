import { useState, useEffect, useMemo } from 'react';
import { getDrones, createDrone, deleteDrone } from '../services/api';
import { Link as RouterLink } from 'react-router-dom';
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
  Link
} from '@mui/material';
import { MdDelete } from 'react-icons/md';

// Interfaces & Types
interface Drone { id: number; name: string; notes?: string; }
type Order = 'asc' | 'desc';

// Sorting Functions
function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
  const valA = a[orderBy] || '';
  const valB = b[orderBy] || '';
  if (valB < valA) return -1;
  if (valB > valA) return 1;
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

function Drones() {
  const [drones, setDrones] = useState<Drone[]>([]);
  const [newDroneName, setNewDroneName] = useState('');
  const [newDroneNotes, setNewDroneNotes] = useState('');
  const [order, setOrder] = useState<Order>('asc');
  const [orderBy, setOrderBy] = useState<keyof Drone>('name');

  useEffect(() => { fetchDrones(); }, []);

  const fetchDrones = async () => {
    const response = await getDrones();
    setDrones(response.data);
  };

  const handleRequestSort = (property: keyof Drone) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedDrones = useMemo(() => 
    stableSort(drones, getComparator(order, orderBy)), 
    [drones, order, orderBy]
  );

  const handleCreateDrone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newDroneName.trim() === '') return;
    await createDrone(newDroneName, newDroneNotes);
    setNewDroneName('');
    setNewDroneNotes('');
    fetchDrones();
  };

  const handleDeleteDrone = async (droneId: number) => {
    if (window.confirm('Are you sure you want to delete this drone?')) {
      await deleteDrone(droneId);
      fetchDrones();
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
      <Paper sx={{ p: 2, flex: 1 }}>
        <Typography variant="h5" component="h2" gutterBottom>Add New Drone</Typography>
        <Box component="form" onSubmit={handleCreateDrone} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField label="Drone Name" variant="outlined" value={newDroneName} onChange={(e) => setNewDroneName(e.target.value)} required />
          <TextField label="Notes (optional)" variant="outlined" multiline rows={4} value={newDroneNotes} onChange={(e) => setNewDroneNotes(e.target.value)} />
          <Button type="submit" variant="contained" sx={{ alignSelf: 'flex-start' }}>Add Drone</Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2, flex: 2 }}>
        <Typography variant="h5" component="h2" gutterBottom>Existing Drones</Typography>
        <TableContainer>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sortDirection={orderBy === 'name' ? order : false}>
                  <TableSortLabel active={orderBy === 'name'} direction={orderBy === 'name' ? order : 'asc'} onClick={() => handleRequestSort('name')}>Name</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={orderBy === 'notes' ? order : false}>
                  <TableSortLabel active={orderBy === 'notes'} direction={orderBy === 'notes' ? order : 'asc'} onClick={() => handleRequestSort('notes')}>Notes</TableSortLabel>
                </TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedDrones.map((drone) => (
                <TableRow key={drone.id} hover>
                  <TableCell><Link component={RouterLink} to={`/drones/${drone.id}`} sx={{ color: 'inherit' }}>{drone.name}</Link></TableCell>
                  <TableCell>{drone.notes}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Delete"><IconButton onClick={() => handleDeleteDrone(drone.id)} size="small"><MdDelete /></IconButton></Tooltip>
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

export default Drones;
