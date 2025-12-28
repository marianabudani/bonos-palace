// bot.js
require('dotenv').config();
const Discord = require('discord.js');
const fs = require('fs');
const path = require('path');

// Configuración desde variables de entorno
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  logsChannelName: process.env.LOGS_CHANNEL_NAME || 'logs🎫',
  bonusChannelName: process.env.BONUS_CHANNEL_NAME || '💰┆calculo-bonos',
  bonusPercentage: parseInt(process.env.BONUS_PERCENTAGE) || 20,
  timezone: process.env.TIMEZONE || 'America/Argentina/Buenos_Aires'
};

// Validar configuración
if (!CONFIG.token) {
  console.error('❌ ERROR: DISCORD_TOKEN no está configurado en las variables de entorno');
  process.exit(1);
}

const client = new Discord.Client({
  intents: [
    Discord.GatewayIntentBits.Guilds,
    Discord.GatewayIntentBits.GuildMessages,
    Discord.GatewayIntentBits.MessageContent
  ]
});

// Base de datos en memoria
let employeeSales = {};
let weekStartDate = new Date();

// Archivo para persistencia
const DATA_FILE = path.join(__dirname, 'sales_data.json');

// Cargar datos al iniciar
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      employeeSales = data.employeeSales || {};
      weekStartDate = new Date(data.weekStartDate) || new Date();
      console.log('✅ Datos cargados correctamente');
    }
  } catch (error) {
    console.error('Error al cargar datos:', error);
  }
}

// Guardar datos
function saveData() {
  try {
    const data = {
      employeeSales,
      weekStartDate: weekStartDate.toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error al guardar datos:', error);
  }
}

// Extraer DNI del formato [ABC12345]
function extractDNI(text) {
  const match = text.match(/\[([A-Z]{3}\d{5})\]/);
  return match ? match[1] : null;
}

// Extraer nombre del empleado
function extractName(text) {
  const match = text.match(/\[([A-Z]{3}\d{5})\]\s+([^h]+)/);
  return match ? match[2].trim() : null;
}

// Extraer monto de la factura
function extractAmount(text) {
  const match = text.match(/\$(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

// Procesar mensaje de log
function processLogMessage(message) {
  const content = message.content;
  
  // Detectar línea de pago de factura
  if (content.includes('ha pagado una factura') && content.includes('de [')) {
    const dni = extractDNI(content);
    const amount = extractAmount(content);
    
    if (dni && amount > 0) {
      // Inicializar empleado si no existe
      if (!employeeSales[dni]) {
        employeeSales[dni] = {
          name: dni,
          sales: 0
        };
      }
      
      // Sumar venta
      employeeSales[dni].sales += amount;
      saveData();
      
      console.log(`💰 Venta registrada: ${dni} - $${amount} (Total: $${employeeSales[dni].sales})`);
      return true;
    }
  }
  
  // Detectar nombre del empleado de otras líneas
  if (content.includes('ha retirado') || content.includes('ha guardado')) {
    const dni = extractDNI(content);
    const name = extractName(content);
    
    if (dni && name && employeeSales[dni]) {
      employeeSales[dni].name = name;
      saveData();
    }
  }
  
  return false;
}

// Calcular bonos
function calculateBonuses() {
  const bonuses = [];
  
  for (const [dni, data] of Object.entries(employeeSales)) {
    const bonus = Math.round(data.sales * (CONFIG.bonusPercentage / 100));
    bonuses.push({
      dni,
      name: data.name,
      sales: data.sales,
      bonus
    });
  }
  
  // Ordenar por ventas (mayor a menor)
  bonuses.sort((a, b) => b.sales - a.sales);
  
  return bonuses;
}

// Generar reporte
function generateReport() {
  const bonuses = calculateBonuses();
  const totalSales = bonuses.reduce((sum, emp) => sum + emp.sales, 0);
  const totalBonuses = bonuses.reduce((sum, emp) => sum + emp.bonus, 0);
  
  const embed = new Discord.EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('📊 REPORTE SEMANAL DE BONOS')
    .setDescription(`**Período:** ${weekStartDate.toLocaleDateString('es-AR')} - ${new Date().toLocaleDateString('es-AR')}`)
    .addFields(
      { name: '💵 Total Ventas', value: `$${totalSales.toLocaleString('es-AR')}`, inline: true },
      { name: '🎁 Total Bonos', value: `$${totalBonuses.toLocaleString('es-AR')}`, inline: true },
      { name: '📈 Porcentaje', value: `${CONFIG.bonusPercentage}%`, inline: true }
    )
    .setTimestamp();
  
  if (bonuses.length === 0) {
    embed.addFields({ name: '❌ Sin datos', value: 'No hay ventas registradas esta semana.' });
    return embed;
  }
  
  // Top empleado
  const topEmployee = bonuses[0];
  embed.addFields({
    name: '🏆 EMPLEADO DESTACADO',
    value: `**${topEmployee.name}** (${topEmployee.dni})\nVentas: $${topEmployee.sales.toLocaleString('es-AR')} | Bono: $${topEmployee.bonus.toLocaleString('es-AR')}`,
    inline: false
  });
  
  // Lista de empleados
  let employeeList = '';
  bonuses.forEach((emp, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▫️';
    employeeList += `${medal} **${emp.name}** (${emp.dni})\n`;
    employeeList += `   └ Ventas: $${emp.sales.toLocaleString('es-AR')} → Bono: $${emp.bonus.toLocaleString('es-AR')}\n\n`;
  });
  
  embed.addFields({ name: '👥 Detalle por Empleado', value: employeeList || 'Sin datos' });
  
  return embed;
}

// Resetear semana
function resetWeek() {
  employeeSales = {};
  weekStartDate = new Date();
  saveData();
  console.log('🔄 Semana reseteada');
}

// Comandos
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Procesar logs automáticamente desde el canal logs🎫
  if (message.channel.name === CONFIG.logsChannelName) {
    processLogMessage(message);
    return;
  }
  
  // Comandos solo funcionan en el canal 💰┆calculo-bonos
  if (message.channel.name !== CONFIG.bonusChannelName) return;
  
  if (!message.content.startsWith('!')) return;
  
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();
  
  // !reporte - Ver reporte actual
  if (command === 'reporte') {
    const embed = generateReport();
    await message.reply({ embeds: [embed] });
  }
  
  // !cerrar - Cerrar semana y resetear
  if (command === 'cerrar') {
    if (!message.member.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Solo administradores pueden cerrar la semana.');
    }
    
    const embed = generateReport();
    await message.reply({ embeds: [embed] });
    await message.channel.send('✅ **Semana cerrada.** Los datos han sido reseteados para la nueva semana.');
    
    resetWeek();
  }
  
  // !porcentaje <número> - Cambiar porcentaje de bono
  if (command === 'porcentaje') {
    if (!message.member.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Solo administradores pueden cambiar el porcentaje.');
    }
    
    const newPercentage = parseInt(args[1]);
    if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) {
      return message.reply('❌ Por favor ingresa un número válido entre 0 y 100.');
    }
    
    CONFIG.bonusPercentage = newPercentage;
    await message.reply(`✅ Porcentaje de bono actualizado a **${newPercentage}%**`);
  }
  
  // !leer - Leer mensajes históricos
  if (command === 'leer') {
    if (!message.member.permissions.has(Discord.PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Solo administradores pueden leer logs históricos.');
    }

    const subCommand = args[1];
    const value = args[2];

    if (!subCommand || !value) {
      return message.reply('❌ Uso: `!leer fecha DD/MM/YYYY` o `!leer cantidad 100`');
    }

    const logsChannel = client.channels.cache.find(ch => ch.name === CONFIG.logsChannelName);
    if (!logsChannel) {
      return message.reply('❌ No se encontró el canal de logs.');
    }

    await message.reply('⏳ Leyendo logs históricos, esto puede tardar un momento...');

    try {
      let messagesToProcess = [];
      let startDate = null;
      let limit = null;

      if (subCommand === 'fecha') {
        // Parsear fecha DD/MM/YYYY
        const [day, month, year] = value.split('/').map(Number);
        if (!day || !month || !year) {
          return message.channel.send('❌ Formato de fecha inválido. Usa: DD/MM/YYYY');
        }
        startDate = new Date(year, month - 1, day);
        startDate.setHours(0, 0, 0, 0);
      } else if (subCommand === 'cantidad') {
        limit = parseInt(value);
        if (isNaN(limit) || limit < 1 || limit > 1000) {
          return message.channel.send('❌ La cantidad debe ser un número entre 1 y 1000.');
        }
      } else {
        return message.channel.send('❌ Subcomando inválido. Usa: `fecha` o `cantidad`');
      }

      // Fetch mensajes
      let lastMessageId;
      let totalFetched = 0;
      let processed = 0;

      while (true) {
        const options = { limit: 100 };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const fetchedMessages = await logsChannel.messages.fetch(options);
        if (fetchedMessages.size === 0) break;

        for (const msg of fetchedMessages.values()) {
          // Filtrar por fecha si se especificó
          if (startDate && msg.createdAt < startDate) {
            continue;
          }

          messagesToProcess.push(msg);
          totalFetched++;

          // Si alcanzamos el límite de cantidad
          if (limit && totalFetched >= limit) {
            break;
          }
        }

        if (limit && totalFetched >= limit) break;
        if (fetchedMessages.size < 100) break;

        lastMessageId = fetchedMessages.last().id;
      }

      // Procesar mensajes en orden cronológico (más antiguos primero)
      messagesToProcess.reverse();
      
      for (const msg of messagesToProcess) {
        if (processLogMessage(msg)) {
          processed++;
        }
      }

      const embed = new Discord.EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Logs Procesados')
        .addFields(
          { name: '📥 Mensajes Leídos', value: `${totalFetched}`, inline: true },
          { name: '💰 Ventas Encontradas', value: `${processed}`, inline: true },
          { name: '📅 Desde', value: startDate ? startDate.toLocaleDateString('es-AR') : 'Últimos mensajes', inline: true }
        )
        .setTimestamp();

      await message.channel.send({ embeds: [embed] });
      await message.channel.send('💡 Usa `!reporte` para ver el resumen actualizado.');

    } catch (error) {
      console.error('Error al leer logs históricos:', error);
      await message.channel.send('❌ Error al procesar los logs. Intenta con una cantidad menor.');
    }
  }

  // !ayuda - Mostrar comandos
  if (command === 'ayuda' || command === 'help') {
    const helpEmbed = new Discord.EmbedBuilder()
      .setColor('#00D9FF')
      .setTitle('📋 Comandos del Bot de Bonos')
      .addFields(
        { name: '!reporte', value: 'Muestra el reporte actual de ventas y bonos' },
        { name: '!cerrar', value: '🔒 Cierra la semana, muestra reporte y resetea datos (Admin)' },
        { name: '!porcentaje <número>', value: '🔒 Cambia el porcentaje de bono (Admin)' },
        { name: '!leer fecha DD/MM/YYYY', value: '🔒 Lee logs desde una fecha específica (Admin)' },
        { name: '!leer cantidad 100', value: '🔒 Lee los últimos N mensajes del canal logs (Admin)' },
        { name: '!ayuda', value: 'Muestra este mensaje' }
      )
      .setFooter({ text: `Porcentaje actual: ${CONFIG.bonusPercentage}%` });
    
    await message.reply({ embeds: [helpEmbed] });
  }
});

// Programar cierre automático los domingos a las 23hs
function scheduleWeeklyClose() {
  setInterval(() => {
    const now = new Date();
    const argTime = new Date(now.toLocaleString('en-US', { timeZone: CONFIG.timezone }));
    
    // Domingo (0) a las 23:00
    if (argTime.getDay() === 0 && argTime.getHours() === 23 && argTime.getMinutes() === 0) {
      console.log('⏰ Cierre automático semanal');
      
      // Buscar el canal por nombre
      const channel = client.channels.cache.find(ch => ch.name === CONFIG.bonusChannelName);
      if (channel) {
        const embed = generateReport();
        channel.send({ embeds: [embed] });
        channel.send('✅ **Semana cerrada automáticamente.** Nueva semana iniciada.');
        resetWeek();
      }
    }
  }, 60000); // Verificar cada minuto
}

// Iniciar bot
client.once('ready', () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);
  console.log(`📺 Leyendo logs de: ${CONFIG.logsChannelName}`);
  console.log(`💰 Comandos en: ${CONFIG.bonusChannelName}`);
  console.log(`📊 Porcentaje de bono: ${CONFIG.bonusPercentage}%`);
  loadData();
  scheduleWeeklyClose();
});

// Manejo de errores
client.on('error', error => {
  console.error('Error del cliente de Discord:', error);
});

process.on('unhandledRejection', error => {
  console.error('Error no manejado:', error);
});

client.login(CONFIG.token);